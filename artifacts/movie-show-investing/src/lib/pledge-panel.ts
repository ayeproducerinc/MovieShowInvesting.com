const PLEDGE_STAGES = ['idea', 'production', 'distribution'];

/**
 * Project-page pledge panel (DECISIONS.md › Product and scope): any submitted,
 * non-hidden project accepts pledges; the confirmed total is public only once
 * the project is approved and listed. Before that, only its own filmmaker sees it.
 */
export function pledgePanel(project: {
  hidden?: boolean;
  approved: boolean;
  showcase_requested: boolean | null;
  stage: string | null;
  is_owner: boolean;
}) {
  const validStage = PLEDGE_STAGES.includes(project.stage ?? '');
  const show = !project.hidden && validStage;
  const listed = show && project.approved && project.showcase_requested === true;
  return {
    show,
    showTotal: listed || (show && project.is_owner),
    ownerOnlyTotal: !listed && show && project.is_owner,
  };
}
