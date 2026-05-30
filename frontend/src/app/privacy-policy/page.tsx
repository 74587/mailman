import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'Privacy Policy | Mailman',
    description: 'Privacy Policy for the Mailman open-source email management project.',
}

const sections = [
    {
        title: 'Overview',
        body: [
            'Mailman is an MIT-licensed open-source email management project. It helps users connect email accounts, synchronize messages, search and read mail, manage mail pickup workflows, and send or forward messages when users choose to do so.',
            'This Privacy Policy describes how Mailman handles information when you use a Mailman deployment. Because Mailman is open source and can be self-hosted, the operator of the specific deployment you use is responsible for the infrastructure, database, storage, backups, and access controls for that deployment.',
        ],
    },
    {
        title: 'Information processed by Mailman',
        body: [
            'Mailman may process account identifiers such as email addresses, OAuth client configuration selected by the user or administrator, access tokens, refresh tokens, mail folders, message metadata, message body content, attachments, account tags, proxy settings, business account records, notes, synchronization settings, audit or execution logs, and other configuration data entered by users.',
            'For Google or Gmail accounts, Mailman only requests and uses Google user data for features that the user or deployment operator enables, such as account authorization, message synchronization, reading message content, searching mail, and sending replies or forwarded messages.',
        ],
    },
    {
        title: 'How information is used',
        body: [
            'Mailman uses the information it processes to provide email management features requested by the user, including authentication, account management, message retrieval, message display, search, mail pickup, trigger execution, and sending or forwarding email.',
            'Mailman does not use Google user data for advertising, does not sell Google user data, and does not transfer Google user data to third parties except as necessary to provide or improve user-facing features, comply with law, protect security, or as directed by the user or deployment operator.',
        ],
    },
    {
        title: 'Google API Services User Data Policy',
        body: [
            'Mailman use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
            'Google user data is used only to provide and improve the user-facing email functionality of Mailman. It is not used to train generalized AI models or for unrelated advertising or profiling purposes.',
        ],
    },
    {
        title: 'Storage and security',
        body: [
            'A Mailman deployment may store OAuth tokens, message data, settings, logs, and user-provided records in its configured database or storage systems. The deployment operator controls retention, backups, encryption, network access, and administrator access.',
            'Users and operators should deploy Mailman with appropriate transport security, database access controls, secret management, and backup policies. As an open-source project, Mailman provides software, but the deployment operator is responsible for operating it securely.',
        ],
    },
    {
        title: 'User choices and deletion',
        body: [
            'Users can disconnect email accounts, revoke OAuth access from the relevant provider, delete accounts or records from Mailman where the deployment exposes that functionality, or ask the deployment operator to remove stored data.',
            'For Google accounts, users can also revoke Mailman access from their Google Account security settings. Revoking access may prevent Mailman from synchronizing, reading, or sending email for that account.',
        ],
    },
    {
        title: 'Open-source repository and contact',
        body: [
            'The Mailman source code is available at https://github.com/seongminhwan/mailman. Security, privacy, or compliance questions can be raised through the repository issue tracker or the contact channel provided by the operator of the deployment you use.',
            'This policy may be updated as Mailman evolves. Material changes should be reflected on this page.',
        ],
    },
]

export default function PrivacyPolicyPage() {
    return (
        <main className="min-h-screen bg-slate-50 text-slate-900">
            <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-10 sm:py-14">
                <header className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <img src="/mailman-logo.svg" alt="Mailman" className="mb-8 h-14 w-auto" />
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Mailman Legal</p>
                    <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">Privacy Policy</h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                        This page is provided for users, deployment operators, and application reviewers who need to understand how Mailman handles email and Google user data.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        <span>Last updated: May 31, 2026</span>
                        <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block" />
                        <Link href="/terms-of-service" className="font-medium text-blue-600 hover:text-blue-700">
                            View Terms of Service
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
