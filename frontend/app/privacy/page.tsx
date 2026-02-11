import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | AI Call Analysis',
  description: 'Privacy Policy for AI Call Analysis (Beta).',
}

const LAST_UPDATED = 'January 26, 2026'
const VERSION = 'v1'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Privacy Policy (Beta)</h1>
          <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-900 underline">
            Sign in
          </Link>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          <span className="font-medium text-gray-900">Version:</span> {VERSION} •{' '}
          <span className="font-medium text-gray-900">Last updated:</span> {LAST_UPDATED}
        </p>

        <div className="mt-8 space-y-6 text-sm text-gray-700">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">1) Overview</h2>
            <p>
              This Privacy Policy explains how AI Call Analysis (“we”, “us”) collects, uses, and shares information when
              you use the Service.
            </p>
            <p className="text-xs text-gray-600">
              This is a template intended to be reviewed by your legal counsel before broad release.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">2) Information we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium">Account information</span> (e.g., name, company name, email, phone, address)
              </li>
              <li>
                <span className="font-medium">Call data</span> you choose to process (e.g., recordings, transcripts, call
                metadata, AI-generated summaries)
              </li>
              <li>
                <span className="font-medium">Usage and device data</span> (e.g., pages viewed, interactions, IP address,
                browser information, and logs)
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">3) How we use information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>to provide, maintain, and improve the Service;</li>
              <li>to process calls you submit for transcription and analysis;</li>
              <li>to provide customer support and communicate with you;</li>
              <li>to secure the Service and prevent abuse;</li>
              <li>to comply with legal obligations.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">4) Sharing</h2>
            <p>
              We may share information with service providers that help us deliver the Service (for example, hosting,
              telephony, analytics, and AI providers). We may also share information if required by law, to protect rights
              and safety, or with your direction.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">5) HIPAA and PHI</h2>
            <p>
              If you require HIPAA compliance, you may need a signed Business Associate Agreement (BAA). Do not process PHI
              through the Service unless an appropriate BAA is in place and you have configured the Service in accordance
              with our instructions.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">6) Data security</h2>
            <p>
              We use reasonable administrative, technical, and organizational safeguards designed to protect information.
              However, no system is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">7) Retention</h2>
            <p>
              We retain information for as long as needed to provide the Service, comply with legal obligations, resolve
              disputes, and enforce agreements, unless a longer or shorter retention period is required or permitted by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">8) Your responsibilities (call recording notices)</h2>
            <p>
              You are responsible for providing notices and obtaining consents required by law for recording and processing
              calls, including where callers are located in jurisdictions requiring two-party consent.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">9) Contact</h2>
            <p>
              Privacy questions? Contact{' '}
              <a className="text-indigo-600 hover:text-indigo-900 underline" href="mailto:privacy@komilio.com">
                privacy@komilio.com
              </a>
              .
            </p>
          </section>

          <div className="pt-4 border-t border-gray-200">
            <Link href="/terms" className="text-indigo-600 hover:text-indigo-900 underline">
              View Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

