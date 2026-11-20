import { verifyCode } from '@/server/auth/flow'

export const POST = (req: Request) => verifyCode(req)
