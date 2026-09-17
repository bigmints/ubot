"use client";

import Link from "next/link";
import { ArrowRight, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StandardPage } from "@/components/workspace-frame";

export default function HelpPage() {
  return <StandardPage width="narrow" title="Help" description="Find guidance for installation, AI providers and visitor messaging.">
    <div className="grid gap-4">
      <section className="flex flex-col rounded-xl border p-6"><Monitor className="mb-4 size-5 text-muted-foreground" /><h2 className="text-xl font-medium">On your computer</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Free Youbot software. You choose and pay for your AI service, or use local AI.</p><ul className="my-5 flex-1 list-disc space-y-2 pl-4 text-sm text-muted-foreground"><li>Your settings and files stay on your machine.</li><li>Keep it awake for scheduled tasks.</li><li>Mac and Windows setup launchers.</li></ul><Button asChild variant="outline"><Link href="/setup">Continue setup <ArrowRight className="size-4" /></Link></Button></section>

    </div>
    <section className="space-y-4"><h2 className="text-lg font-medium">Installing on a computer</h2><ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed"><li>Download and extract the Youbot release folder.</li><li>On Mac, open <strong>Start Youbot.command</strong>. On Windows, open <strong>Start Youbot.cmd</strong>.</li><li>Your browser opens the setup guide. Choose your login, then let setup finish.</li><li>Open Youbot, sign in, and connect your AI service.</li></ol><p className="text-sm text-muted-foreground">These launchers are not signed native installers. If your computer blocks the launcher, follow the instructions in START HERE.md. Don’t disable your computer’s security settings.</p></section>
    <section className="divide-y border-y">
      {[
        ["Why does Youbot need an AI key?", "An AI key connects self-hosted Youbot to your own AI account. A ChatGPT or other chat-app subscription may not include API usage. Check your provider’s account and billing page."],
        ["Why did my concierge stop?", "On your computer, Youbot needs the Start Youbot window open and the computer awake. Reopen the launcher to start again. Your saved data stays on the computer."],
        ["My message didn’t get a reply.", "Check AI settings for your key and model, and check whether your AI account has available credit. If your connection dropped, reload the conversation before sending the same request again."],
        ["Where is my local data?", "The desktop launcher saves settings, conversations, and files in the .youbot-desktop folder in your home folder. Setup logs are in setup.log inside that folder. Keep this folder when updating Youbot."],
      ].map(([title, body]) => <details key={title} className="py-4"><summary className="cursor-pointer text-sm font-medium">{title}</summary><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p></details>)}
    </section>
    <div className="flex flex-wrap gap-5 text-sm"><Link className="underline underline-offset-4" href="/setup">Setup guide</Link><Link className="underline underline-offset-4" href="/llms">AI settings</Link><Link className="underline underline-offset-4" href="/logs">Troubleshooting logs</Link></div>
  </StandardPage>;
}
