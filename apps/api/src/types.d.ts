import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      company_id: string;
      display_name: string;
      email: string;
    };
  }
}
