import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser, userHasPermission } from './auth.js';
import { pool } from './db.js';
import { salesSummaryCsv, summarizeSales, type SalesReportRow, type SalesSummary } from './reports-domain.js';

type User = { id: string; company_id: string };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({ dateFrom: date, dateTo: date, branchId: z.string().uuid().optional() });

function currentUser(request: FastifyRequest): User { return request.user as User; }

async function requirePermission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (!(await userHasPermission(currentUser(request).id, code))) {
    await reply.code(403).send({ error: 'Permiso insuficiente' });
    return false;
  }
  return true;
}

function parseQuery(request: FastifyRequest, reply: FastifyReply): z.infer<typeof querySchema> | null {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success || parsed.data.dateFrom >= parsed.data.dateTo) {
    void reply.code(400).send({ error: 'dateFrom y dateTo invalidos; dateTo debe ser posterior' });
    return null;
  }
  return parsed.data;
}

function branchScope(user: User, branchId: string | undefined, start: string, end: string): { sql: string; values: unknown[] } {
  const values: unknown[] = [user.company_id, user.id, `${start}T00:00:00.000Z`, `${end}T00:00:00.000Z`];
  const branch = branchId ? 'AND o.branch_id = $5' : '';
  if (branchId) values.push(branchId);
  return {
    sql: `o.company_id = $1 AND o.created_at >= $3::timestamptz AND o.created_at < $4::timestamptz
      AND EXISTS (SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
                 WHERE b.id = o.branch_id AND b.company_id = o.company_id AND b.is_active AND ub.user_id = $2)
      ${branch}`,
    values,
  };
}

async function salesSummary(db: Queryable, user: User, filter: z.infer<typeof querySchema>): Promise<SalesSummary> {
  const scope = branchScope(user, filter.branchId, filter.dateFrom, filter.dateTo);
  const result = await db.query(
    `SELECT o.id order_id, o.status, o.total, p.method, p.amount payment_amount
     FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.company_id = o.company_id
     WHERE ${scope.sql} AND o.status IN ('COMPLETED', 'CANCELLED')
     ORDER BY o.created_at, p.created_at`, scope.values,
  );
  return summarizeSales(result.rows as SalesReportRow[]);
}

async function canReadScope(request: FastifyRequest, reply: FastifyReply, branchId: string | undefined): Promise<boolean> {
  return requirePermission(request, reply, branchId ? 'report.branch.read' : 'report.company.read');
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/reports/sales-summary', { preHandler: requireUser }, async (request, reply) => {
    const filter = parseQuery(request, reply);
    if (!filter || !(await canReadScope(request, reply, filter.branchId))) return;
    return { data: await salesSummary(pool, currentUser(request), filter), filters: filter };
  });

  app.get('/api/v1/reports/sales-summary.csv', { preHandler: requireUser }, async (request, reply) => {
    const filter = parseQuery(request, reply);
    if (!filter || !(await canReadScope(request, reply, filter.branchId)) || !(await requirePermission(request, reply, 'export.read'))) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const summary = await salesSummary(client, currentUser(request), filter);
      await client.query(
        `INSERT INTO audit_logs (company_id, branch_id, actor_id, entity_type, action, new_values)
         VALUES ($1,$2,$3,'report_export','report.exported',$4)`,
        [currentUser(request).company_id, filter.branchId ?? null, currentUser(request).id, JSON.stringify({ report: 'sales-summary', filters: filter, format: 'csv' })],
      );
      await client.query('COMMIT');
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="sales-summary-${filter.dateFrom}-${filter.dateTo}.csv"`).send(salesSummaryCsv(summary));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.get('/api/v1/reports/operations-summary', { preHandler: requireUser }, async (request, reply) => {
    const filter = parseQuery(request, reply);
    if (!filter || !(await canReadScope(request, reply, filter.branchId))) return;
    const user = currentUser(request);
    const scope = branchScope(user, filter.branchId, filter.dateFrom, filter.dateTo);
    const result = await pool.query(
      `SELECT
        (SELECT count(*) FROM orders o WHERE ${scope.sql} AND o.status IN ('DRAFT','CONFIRMED','SENT_TO_KITCHEN','CANCELLATION_REQUESTED')) open_orders,
        (SELECT count(*) FROM orders o WHERE ${scope.sql} AND o.kitchen_status = 'PENDING') pending_kitchen,
        (SELECT count(*) FROM orders o WHERE ${scope.sql} AND o.kitchen_status IN ('PENDING','IN_PROGRESS') AND o.created_at < now() - interval '15 minutes') delayed_kitchen,
        (SELECT count(*) FROM restaurant_tables t WHERE t.company_id = $1 AND t.status = 'OCCUPIED' AND EXISTS (SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id=b.id WHERE b.id=t.branch_id AND b.is_active AND ub.user_id=$2 ${filter.branchId ? 'AND b.id=$5' : ''})) occupied_tables,
        (SELECT count(DISTINCT o.table_id) FROM orders o WHERE ${scope.sql} AND o.table_id IS NOT NULL AND o.status IN ('DRAFT','CONFIRMED','SENT_TO_KITCHEN','CANCELLATION_REQUESTED')) open_tables,
        (SELECT count(DISTINCT a.product_id) FROM branch_product_availability a WHERE a.is_available = false AND EXISTS (SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id=b.id WHERE b.id=a.branch_id AND b.company_id=$1 AND b.is_active AND ub.user_id=$2 ${filter.branchId ? 'AND b.id=$5' : ''})) unavailable_products`,
      scope.values,
    );
    const row = result.rows[0];
    return { data: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])), filters: filter, delayedKitchenThresholdMinutes: 15 };
  });
}