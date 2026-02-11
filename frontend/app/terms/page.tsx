import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service | AI Call Analysis',
  description: 'Terms of Service for AI Call Analysis (Beta).',
}

const LAST_UPDATED = 'January 26, 2026'
const VERSION = 'v1'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Terms of Service (Beta)</h1>
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
            <h2 className="text-base font-semibold text-gray-900">1) Overview and acceptance</h2>
            <p>
              These Terms of Service (the “Terms”) govern your access to and use of AI Call Analysis (the “Service”). By
              creating an account, accessing, or using the Service, you agree to these Terms.
            </p>
            <p className="text-xs text-gray-600">
              This is a template intended to be reviewed by your legal counsel before broad release.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">2) Beta status</h2>
            <p>
              The Service is provided as a beta offering. Features may change, be removed, or be unavailable at any time,
              and the Service may contain bugs or errors. You understand and agree that you use the Service at your own
              risk.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">3) Call recording, consent, and notices</h2>
            <p>
              You are solely responsible for complying with all laws and regulations that apply to your calls, including
              laws governing call recording, monitoring, and the confidentiality of communications.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                You represent and warrant that you have obtained all required consents and provided all required notices
                before recording any call, and that you will continue to do so.
              </li>
              <li>
                You agree to inform your callers that calls may be recorded and analyzed, including by automated tools.
              </li>
              <li>
                You agree not to use the Service to record calls where recording is prohibited or where required consent
                has not been obtained.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">4) Your content and responsibilities</h2>
            <p>
              You are responsible for all audio, transcripts, and other data you upload, transmit, or process using the
              Service (“Customer Content”). You represent and warrant that you have all rights, permissions, and
              consents necessary for Customer Content to be processed as described in these Terms.
            </p>
            <p>
              You are responsible for maintaining the confidentiality of your login credentials and for all activities
              that occur under your account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">5) HIPAA (healthcare) terms</h2>
            <p>
              If you are a HIPAA covered entity or business associate and you intend to process Protected Health
              Information (PHI) through the Service, you are responsible for ensuring your use complies with HIPAA and
              other applicable laws.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                If a Business Associate Agreement (BAA) is required for your use case, you must have an executed BAA in
                place with us before you process PHI using the Service.
              </li>
              <li>
                You are responsible for your own systems and configurations (including phone systems, call routing, and
                any third-party integrations) and for ensuring they meet your compliance obligations.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">6) PCI and payment card data</h2>
            <p>
              The Service may include features intended to help reduce exposure to payment card information (for example,
              redaction of certain patterns). These features are not a guarantee of compliance.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                You are responsible for complying with PCI DSS and applicable payment network rules.
              </li>
              <li>
                You agree not to intentionally collect, store, or transmit sensitive authentication data (such as CVV/CVC
                codes) through the Service.
              </li>
              <li>
                You remain responsible for training your staff and implementing appropriate processes to prevent
                unnecessary capture of cardholder data.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">7) Third-party services and AI processing</h2>
            <p>
              The Service may use third-party subprocessors and APIs (for example, telephony providers and AI model
              providers) to provide functionality such as transcription and analysis. You authorize us to process Customer
              Content through such providers as necessary to provide the Service.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">8) Prohibited use</h2>
            <p>You agree not to misuse the Service, including to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>violate any law or regulation;</li>
              <li>attempt to access accounts or systems without authorization;</li>
              <li>upload malware or otherwise interfere with the Service;</li>
              <li>reverse engineer or attempt to derive source code (except as permitted by law).</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">9) Disclaimers</h2>
            <p className="uppercase text-xs text-gray-600">
              The service is provided “as is” and “as available”.
            </p>
            <p>
              We disclaim all warranties of any kind, whether express or implied, including implied warranties of
              merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service
              will be uninterrupted, secure, or error-free, or that analysis outputs will be accurate or complete.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">10) Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, we will not be liable for any indirect, incidental, special,
              consequential, or punitive damages, or any loss of profits, revenues, data, or goodwill.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">11) Termination</h2>
            <p>
              We may suspend or terminate access to the Service if you violate these Terms, if needed to protect the
              Service, or as otherwise permitted by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">12) Contact</h2>
            <p>
              Questions about these Terms? Contact support at{' '}
              <a className="text-indigo-600 hover:text-indigo-900 underline" href="mailto:support@komilio.com">
                support@komilio.com
              </a>
              .
            </p>
          </section>

          <div className="pt-4 border-t border-gray-200">
            <Link href="/privacy" className="text-indigo-600 hover:text-indigo-900 underline">
              View Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

