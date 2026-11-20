/** Messages from the public contact form. */
import { pg } from './db'

export const MESSAGE_STATUSES = ['new', 'read', 'archived'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export interface Message {
  id: string
  received_at: Date
  name: string
  email: string
  topic: string
  body: string
  ip_prefix: string | null
  status: MessageStatus
  mailed: boolean
}

export async function listMessages(view: 'inbox' | 'archived'): Promise<Message[]> {
  return view === 'archived'
    ? pg()<Message[]>`
        select * from nullroute.messages where status = 'archived' order by received_at desc limit 200`
    : pg()<Message[]>`
        select * from nullroute.messages where status <> 'archived' order by received_at desc limit 200`
}

export async function messageCounts(): Promise<{ new: number; inbox: number; archived: number }> {
  const [row] = await pg()<{ new: number; inbox: number; archived: number }[]>`
    select count(*) filter (where status = 'new') as new,
           count(*) filter (where status <> 'archived') as inbox,
           count(*) filter (where status = 'archived') as archived
    from nullroute.messages`
  return row ?? { new: 0, inbox: 0, archived: 0 }
}

export async function setMessageStatus(id: string, status: MessageStatus): Promise<void> {
  await pg()`update nullroute.messages set status = ${status} where id = ${id}`
}

export async function deleteMessage(id: string): Promise<void> {
  await pg()`delete from nullroute.messages where id = ${id}`
}
