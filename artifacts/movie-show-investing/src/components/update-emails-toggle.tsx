import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInvestorUpdateEmailsQueryKey, useGetInvestorUpdateEmails, useSetInvestorUpdateEmails } from '@workspace/api-client-react';

/** Project update emails: on by default for backers; this switch turns them off or back on. */
export function UpdateEmailsToggle({ identityId }: { identityId: string }) {
  const queryClient = useQueryClient();
  const preference = useGetInvestorUpdateEmails({ query: { queryKey: [...getGetInvestorUpdateEmailsQueryKey(), identityId], retry: false } });
  const update = useSetInvestorUpdateEmails();
  const [failed, setFailed] = useState(false);
  if (!preference.isSuccess || !preference.data.has_investor_record) return null;
  async function save(enabled: boolean) {
    setFailed(false);
    try {
      const result = await update.mutateAsync({ data: { enabled } });
      queryClient.setQueryData([...getGetInvestorUpdateEmailsQueryKey(), identityId], result);
    } catch { setFailed(true); }
  }
  return <section className="inv-section" aria-label="Project update emails" data-testid="update-emails-toggle">
    <label className="fm-check">
      <input type="checkbox" checked={preference.data.enabled} disabled={update.isPending}
        onChange={event => void save(event.target.checked)} data-testid="checkbox-update-emails"/>
      <span>Email me when projects I’ve backed post updates.</span>
    </label>
    <p className="inv-small" role="status">{failed ? 'That didn’t save. Please try again.' : preference.data.enabled ? 'Update emails are on.' : 'Update emails are off.'}</p>
  </section>;
}
