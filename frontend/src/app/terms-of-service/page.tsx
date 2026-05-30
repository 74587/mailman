import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'Terms of Service | Mailman',
    description: 'Terms of Service for the Mailman open-source email management project.',
}

const sections = [
    {
        title: 'Acceptance of terms',
        body: [
            'These Terms of Service apply to use of the Mailman software and to any Mailman deployment that links to this page. By using Mailman, you agree to use it responsibly and in compliance with applicable laws, provider policies, and the rules of the deployment operator.',
            'If you use a self-hosted deployment, the organization or individual operating that deployment may provide additional terms. Those deployment-specific terms may supplement these terms.',
        ],
    },
    {
        title: 'Open-source license',
        body: [
            'Mailman is provided as open-source software under the MIT License. The MIT License grants broad permission to use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the license notice and disclaimer.',
            'The MIT License applies to the Mailman source code. It does not grant rights to third-party services, email provider accounts, Google Cloud projects, trademarks, hosted infrastructure, or data controlled by a deployment operator.',
        ],
    },
    {
        title: 'Permitted use',
        body: [
            'Mailman may be used to manage email accounts that you own, administer, or are authorized to access. You are responsible for ensuring that your use of email synchronization, search, forwarding, triggers, proxies, and sending features is lawful and authorized.',
            'You may not use Mailman to access accounts without permission, send spam or abusive messages, evade provider limits, interfere with service security, or violate Google, Gmail, email provider, hosting provider, or network policies.',
        ],
    },
    {
        title: 'Google and third-party services',
        body: [
            'When Mailman connects to Google, Gmail, or other third-party services, those services may require their own terms, API policies, and user consent screens. You are responsible for configuring OAuth clients, scopes, redirect URIs, and consent settings correctly.',
            'Mailman is not responsible for third-party service outages, policy changes, account suspensions, quota limits, API changes, or data handling performed outside the Mailman deployment.',
        ],
    },
    {
        title: 'User data and account security',
        body: [
            'Mailman may store sensitive operational data such as OAuth tokens, email content, account configuration, notes, business account records, and logs. Users and deployment operators are responsible for protecting credentials, limiting access, and removing data that should no longer be stored.',
            'If you believe a Mailman deployment is mishandling data, contact the deployment operator. For source-code issues, use the project repository at https://github.com/seongminhwan/mailman.',
        ],
    },
    {
        title: 'No warranty',
        body: [
            'Mailman is provided on an as-is and as-available basis. To the maximum extent permitted by law, the project maintainers provide no warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, security, availability, or error-free operation.',
            'You are responsible for testing Mailman before production use and for maintaining backups, monitoring, access controls, and incident response procedures appropriate for your deployment.',
        ],
    },
    {
        title: 'Limitation of liability',
        body: [
            'To the maximum extent permitted by law, the Mailman project maintainers are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of data, profits, goodwill, business opportunities, or service availability arising from use of Mailman.',
            'Deployment operators may have separate responsibilities to their own users based on their own terms, privacy policy, contracts, and applicable law.',
        ],
    },
    {
        title: 'Changes and contact',
        body: [
            'These terms may be updated as Mailman evolves. Continued use after updates means you accept the updated terms for the deployment that links to them.',
            'The Mailman source code and project issue tracker are available at https://github.com/seongminhwan/mailman.',
        ],
    },
]

export default function TermsOfServicePage() {
    return (
        <main className="min-h-screen bg-slate-50 text-slate-900">
            <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-10 sm:py-14">
                <header className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <img src="/mailman-logo.svg" alt="Mailman" className="mb-8 h-14 w-auto" />
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Mailman Legal</p>
                    <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">Terms of Service</h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                        These terms describe responsible use of Mailman, an MIT-licensed open-source email operations platform.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        <span>Last updated: May 31, 2026</span>
                        <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block" />
                        <Link href="/privacy-policy" className="font-medium text-blue-600 hover:text-blue-700">
                            View Privacy Policy
                        </Link>
                    </div>
                </header>

                <div className="grid gap-6 lg:grid-cols-[220px,1fr]">
                    <aside className="hidden lg:block">
                        <nav className="sticky top-8 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                            <div className="mb-3 font-semibold text-slate-900">Contents</div>
                            <div className="space-y-2">
                                {sections.map(section => (
                                    <a key={section.title} href={`#${section.title.toLowerCase().replaceAll(' ', '-')}`} className="block rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-blue-600">
                                        {section.title}
                                    </a>
                                ))}
                            </div>
                        </nav>
                    </aside>

                    <article className="space-y-5">
                        {sections.map(section => (
                            <section key={section.title} id={section.title.toLowerCase().replaceAll(' ', '-')} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                                <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
                                <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                                    {section.body.map(paragraph => (
                                        <p key={paragraph}>{paragraph}</p>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </article>
                </div>
            </div>
        </main>
    )
}
