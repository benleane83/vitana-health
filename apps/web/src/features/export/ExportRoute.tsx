import { useState } from "react";
import type { AppBootstrap } from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { ExportPage } from "../../pages/ExportPage.js";

export function ExportRoute({ bootstrap }: { bootstrap?: AppBootstrap }) {
  const [status, setStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function download() {
    setStatus({ busy: true });
    try {
      const { blob, filename } = await api.exportPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ busy: false });
    } catch (error) {
      setStatus({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to create the PDF report."
      });
    }
  }

  return (
    <ExportPage
      busy={status.busy}
      error={status.error}
      hasHealthData={Boolean(
        bootstrap && (bootstrap.counts.observations || bootstrap.counts.samples || bootstrap.counts.activities)
      )}
      onDownload={() => { void download(); }}
    />
  );
}