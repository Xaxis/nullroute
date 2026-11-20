import { contactPreflight, submitContact } from '@/server/contact'

export const OPTIONS = (req: Request) => contactPreflight(req)
export const POST = (req: Request) => submitContact(req)
