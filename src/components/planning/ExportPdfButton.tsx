'use client'

import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ExportPdfButtonProps {
  periodeId: string
}

export function ExportPdfButton({ periodeId }: ExportPdfButtonProps) {
  return (
    <div className="flex justify-end">
      <Button
        variant="outline"
        onClick={() => { window.location.href = `/api/export-pdf?periodeId=${periodeId}` }}
      >
        <FileText className="w-4 h-4 mr-2" />
        Exporter PDF
      </Button>
    </div>
  )
}
