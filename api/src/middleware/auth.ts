import { FastifyRequest, FastifyReply } from 'fastify'
import { JwtPayload } from '../auth/jwt.js'

// Augment @fastify/jwt so req.user is typed as JwtPayload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify()
  } catch {
    return reply.status(401).send({ code: 'UNAUTHORIZED' })
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply)
  if (req.user?.role !== 'admin') {
    return reply.status(403).send({ code: 'FORBIDDEN' })
  }
}

export async function requireOperatorOrAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply)
  if (!['admin', 'operator'].includes(req.user?.role)) {
    return reply.status(403).send({ code: 'FORBIDDEN' })
  }
}
