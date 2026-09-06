import { addMovement, conversionFactor } from './inventory.js';
import { convertQuantity } from './inventory-domain.js';

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: any[] }> };

function trimmed(value: number): string {
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export async function applyTheoreticalConsumption(client: Client, input: {
  companyId: string; branchId: string; orderId: string; orderFolio: number; actorId: string;
}): Promise<number> {
  const warehouse = await client.query(
    'SELECT id FROM warehouses WHERE company_id=$1 AND branch_id=$2 AND is_active ORDER BY name LIMIT 1',
    [input.companyId, input.branchId],
  );
  if (warehouse.rowCount !== 1) return 0;
  const sold = await client.query(
    `SELECT oi.product_id, SUM(oi.quantity)::numeric sold_quantity FROM order_items oi
     WHERE oi.order_id=$1 GROUP BY oi.product_id`,
    [input.orderId],
  );
  if (sold.rowCount === 0) return 0;
  const productIds = sold.rows.map((row: { product_id: string }) => row.product_id);
  const recipes = await client.query(
    `SELECT r.id FROM recipes r
     WHERE r.company_id=$1 AND r.is_active AND (r.branch_id IS NULL OR r.branch_id=$2) AND r.product_id=ANY($3::uuid[])`,
    [input.companyId, input.branchId, productIds],
  );
  if (recipes.rowCount === 0) return 0;
  const recipeIds = recipes.rows.map((row: { id: string }) => row.id);
  const versions = await client.query(
    `SELECT DISTINCT ON (rv.recipe_id) rv.id version_id, rv.recipe_id, r.product_id
     FROM recipe_versions rv JOIN recipes r ON r.id=rv.recipe_id
     WHERE rv.recipe_id=ANY($1::uuid[]) ORDER BY rv.recipe_id, rv.version DESC`,
    [recipeIds],
  );
  const versionById = new Map<string, { recipe_id: string; product_id: string }>();
  for (const row of versions.rows) versionById.set(row.version_id, { recipe_id: row.recipe_id, product_id: row.product_id });
  const versionIds = [...versionById.keys()];
  const items = (await client.query(
    `SELECT ri.recipe_version_id version_id, ri.ingredient_id, ri.quantity item_quantity, ri.unit_id unit_id,
       i.base_unit_id base_unit_id
     FROM recipe_items ri JOIN ingredients i ON i.id=ri.ingredient_id
     WHERE ri.recipe_version_id=ANY($1::uuid[]) AND i.is_active`,
    [versionIds],
  )).rows;
  const soldById = new Map(sold.rows.map((row: { product_id: string; sold_quantity: string }) => [row.product_id, row.sold_quantity]));
  const reason = `Consumo teorico pedido ${input.orderFolio}`;
  let consumed = 0;
  for (const item of items) {
    const factor = item.unit_id === item.base_unit_id
      ? '1'
      : await conversionFactor(client, input.companyId, item.unit_id, item.base_unit_id);
    if (!factor) continue;
    const version = versionById.get(item.version_id);
    if (!version) continue;
    const soldQuantity = Number(soldById.get(version.product_id) ?? '0');
    if (soldQuantity <= 0) continue;
    const baseQuantity = Number(convertQuantity(item.item_quantity, factor)) * soldQuantity;
    const quantityInUnit = trimmed(Number(item.item_quantity) * soldQuantity);
    await addMovement(client, {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: warehouse.rows[0].id,
      ingredientId: item.ingredient_id,
      movementType: 'THEORETICAL_CONSUMPTION',
      quantity: quantityInUnit,
      unitId: item.unit_id,
      reason,
      actorId: input.actorId,
      referenceId: input.orderId,
      signedDelta: `-${trimmed(baseQuantity)}`,
      allowNegative: true,
    });
    consumed += 1;
  }
  return consumed;
}