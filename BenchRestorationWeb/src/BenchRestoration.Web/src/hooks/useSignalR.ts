import { useEffect, useRef, useState, useCallback } from 'react'
import * as signalR from '@microsoft/signalr'

interface StatusUpdate {
  message: string
  color: string
}

interface RestoreCompleteEvent {
  historyId: number
  success: boolean
  databaseName: string
}

interface CopyProgressEvent {
  percent: number
  copiedMb: number
  totalMb: number
}

interface RestoreProgressEvent {
  percent: number
  phase: string
  database: string
}

export interface AzureStatusUpdateEvent {
  historyIds: number[]
  releaseId: string
  status: string
  rawStatus: string
  color: string
}

export function useSignalR() {
  const connectionRef = useRef<signalR.HubConnection | null>(null)
  const [lastStatus, setLastStatus] = useState<StatusUpdate | null>(null)
  const [lastRestoreComplete, setLastRestoreComplete] = useState<RestoreCompleteEvent | null>(null)
  const [copyProgress, setCopyProgress] = useState<CopyProgressEvent | null>(null)
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgressEvent | null>(null)
  const [azureStatus, setAzureStatus] = useState<AzureStatusUpdateEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const restoreCompleteCallbackRef = useRef<((event: RestoreCompleteEvent) => void) | null>(null)
  const copyProgressCallbackRef = useRef<((event: CopyProgressEvent) => void) | null>(null)
  const restoreProgressCallbackRef = useRef<((event: RestoreProgressEvent) => void) | null>(null)
  const azureStatusCallbackRef = useRef<((event: AzureStatusUpdateEvent) => void) | null>(null)

  const onRestoreComplete = useCallback((callback: (event: RestoreCompleteEvent) => void) => {
    restoreCompleteCallbackRef.current = callback
  }, [])

  const onCopyProgress = useCallback((callback: (event: CopyProgressEvent) => void) => {
    copyProgressCallbackRef.current = callback
  }, [])

  const onRestoreProgress = useCallback((callback: (event: RestoreProgressEvent) => void) => {
    restoreProgressCallbackRef.current = callback
  }, [])

  const onAzureStatus = useCallback((callback: (event: AzureStatusUpdateEvent) => void) => {
    azureStatusCallbackRef.current = callback
  }, [])

  useEffect(() => {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/restore')
      .withAutomaticReconnect()
      .build()

    connection.on('StatusUpdate', (update: StatusUpdate) => {
      setLastStatus(update)
    })

    connection.on('CopyProgress', (event: CopyProgressEvent) => {
      setCopyProgress(event)
      copyProgressCallbackRef.current?.(event)
    })

    connection.on('RestoreProgress', (event: RestoreProgressEvent) => {
      setRestoreProgress(event)
      restoreProgressCallbackRef.current?.(event)
    })

    connection.on('RestoreComplete', (event: RestoreCompleteEvent) => {
      setLastRestoreComplete(event)
      restoreCompleteCallbackRef.current?.(event)
    })

    connection.on('AzureStatusUpdate', (event: AzureStatusUpdateEvent) => {
      setAzureStatus(event)
      azureStatusCallbackRef.current?.(event)
    })

    connection.onclose(() => setIsConnected(false))
    connection.onreconnected(() => setIsConnected(true))

    connection.start()
      .then(() => setIsConnected(true))
      .catch(console.error)

    connectionRef.current = connection

    return () => {
      connection.stop()
    }
  }, [])

  return { lastStatus, lastRestoreComplete, copyProgress, restoreProgress, azureStatus, isConnected, onRestoreComplete, onCopyProgress, onRestoreProgress, onAzureStatus }
}
