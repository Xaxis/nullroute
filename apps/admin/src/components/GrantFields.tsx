import { GRANT_STATUSES, type Grant, LABELS } from '@/server/grants'
import { Field, Input, Select, Textarea } from './ui'

/** The grant form's fields, shared by "new" and "edit". */
export function GrantFields({ grant }: { grant?: Grant }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Funder">
        <Input
          name="funder"
          required
          maxLength={120}
          defaultValue={grant?.funder ?? ''}
          placeholder="OpenSats"
        />
      </Field>
      <Field label="Program">
        <Input
          name="program"
          required
          maxLength={160}
          defaultValue={grant?.program ?? ''}
          placeholder="General grant"
        />
      </Field>
      <Field label="Title" className="sm:col-span-2">
        <Input
          name="title"
          required
          maxLength={200}
          defaultValue={grant?.title ?? ''}
          placeholder="What the application is called"
        />
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={grant?.status ?? 'drafting'}>
          {GRANT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Link" hint="The funder's page or the submitted application.">
        <Input
          name="url"
          type="url"
          maxLength={500}
          defaultValue={grant?.url ?? ''}
          placeholder="https://"
        />
      </Field>
      <Field label="Window opens">
        <Input name="window_opens" type="date" defaultValue={grant?.window_opens ?? ''} />
      </Field>
      <Field label="Window closes">
        <Input name="window_closes" type="date" defaultValue={grant?.window_closes ?? ''} />
      </Field>
      <Field label="Submitted on">
        <Input name="submitted_on" type="date" defaultValue={grant?.submitted_on ?? ''} />
      </Field>
      <Field label="Decided on">
        <Input name="decided_on" type="date" defaultValue={grant?.decided_on ?? ''} />
      </Field>
      <Field label="Amount (USD)">
        <Input
          name="amount_usd"
          inputMode="numeric"
          pattern="[0-9,]*"
          defaultValue={grant?.amount_usd ?? ''}
          placeholder="Requested or awarded"
        />
      </Field>
      <Field label="Duration (months)">
        <Input
          name="duration_months"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={grant?.duration_months ?? ''}
        />
      </Field>
      <Field label="Commitment" className="sm:col-span-2">
        <Input
          name="commitment"
          maxLength={200}
          defaultValue={grant?.commitment ?? ''}
          placeholder="Time commitment, e.g. 50 percent"
        />
      </Field>
      <Field label="Summary" className="sm:col-span-2" hint="One paragraph: what the grant funds.">
        <Textarea name="summary" maxLength={4000} defaultValue={grant?.summary ?? ''} />
      </Field>
      <Field label="Notes" className="sm:col-span-2" hint="Private working notes. Markdown.">
        <Textarea
          name="notes"
          maxLength={20000}
          defaultValue={grant?.notes ?? ''}
          className="min-h-32"
        />
      </Field>
    </div>
  )
}
