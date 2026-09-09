// Mints a fresh, short-lived (1 day — see controllers/authRouter.ts's
// createExportDownloadToken) download token every time the user clicks
// Download, rather than the old design of one long-lived signed URL
// baked in at export-completion time. The object itself stays private
// (GCS bucket has public_access_prevention enforced — see
// IaC/environments/prod/main.tf); this token is the only thing that lets
// controllers/exportDownloadController.ts's proxy route serve it.
export class ExportNotFoundError extends Error {}
export class ExportNotReadyError extends Error {}

export interface CreateExportDownloadTokenDeps {
  findRequest: () => Promise<{ status: string; storageKey: string | null } | null>
  signToken: () => string
}

export async function createExportDownloadToken(deps: CreateExportDownloadTokenDeps): Promise<string> {
  const request = await deps.findRequest()
  if (!request) {
    throw new ExportNotFoundError('export request not found')
  }
  if (request.status !== 'ready' || !request.storageKey) {
    throw new ExportNotReadyError('export is not ready for download')
  }
  return deps.signToken()
}
