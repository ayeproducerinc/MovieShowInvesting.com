import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ProjectConversationEntry } from '@/components/project-conversation-entry';

export function ProjectContactDialog({ slug, title, filmmakerName, resetKey }: { slug: string; title: string; filmmakerName?: string | null; resetKey: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [resetKey]);
  const who = filmmakerName?.trim();
  return <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="dossier-button dossier-button-outline pj-contact-btn" data-testid="button-message-filmmaker">Message filmmaker <ArrowUpRight size={16}/></button>
      </DialogTrigger>
      <DialogContent className="dossier pj-dialog" data-testid="dialog-message-filmmaker">
        <DialogTitle className="pj-dialog-title">{who ? `Message ${who} about ${title}` : `Message the filmmaker of ${title}`}</DialogTitle>
        <DialogDescription className="pj-dialog-desc">Private, text-only correspondence about this film. It is not an investment commitment.</DialogDescription>
        <ProjectConversationEntry slug={slug}/>
      </DialogContent>
    </Dialog>;
}
