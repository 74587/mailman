'use client'

import React, { useEffect } from 'react'
import { configureMonaco } from '@/lib/monaco-config'
import { TriggerCreationWizard } from '@/components/triggers/create/trigger-creation-wizard'

// Configure Monaco to use local package instead of CDN
// This must be done before any Monaco editor is mounted
configureMonaco()

export default function CreateTriggerPage() {
  return <TriggerCreationWizard />
}