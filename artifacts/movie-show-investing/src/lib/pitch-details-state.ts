export type PitchDetailsFields = {
  publicName: string;
  links: string;
  teamInfo: string;
  moneyUse: string;
  distribution: string;
  cfRan: boolean | null;
  cfCampaign: string;
  cfSame: boolean | null;
  cfGoal: string;
  cfRaised: string;
  cfObligations: string;
};

/** Compare what the explicit details save actually sends, including crowdfunding. */
export function pitchDetailsFingerprint(fields: PitchDetailsFields): string {
  const clean = (value: string) => value.trim() || null;
  const amount = (value: string) => !value.trim() ? null
    : Number.isFinite(Number(value)) ? Number(value) : value.trim();
  return JSON.stringify([
    clean(fields.publicName),
    fields.links.split('\n').map(link => link.trim()).filter(Boolean),
    clean(fields.teamInfo), clean(fields.moneyUse), clean(fields.distribution),
    fields.cfRan,
    ...(fields.cfRan === true ? [
      clean(fields.cfCampaign), fields.cfSame, amount(fields.cfGoal),
      amount(fields.cfRaised), clean(fields.cfObligations),
    ] : []),
  ]);
}