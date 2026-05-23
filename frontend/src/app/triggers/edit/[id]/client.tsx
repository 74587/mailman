'use client'

import { useParams } from 'next/navigation'
import { TriggerEditWizard } from '@/components/triggers/create/trigger-edit-wizard'

export default function EditTriggerClient() {
  const params = useParams()
  const triggerId = parseInt(params.id as string)

  return <TriggerEditWizard triggerId={triggerId} readOnly={false} />
}
