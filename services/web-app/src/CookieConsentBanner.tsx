import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as CookieConsent from 'vanilla-cookieconsent'
import 'vanilla-cookieconsent/dist/cookieconsent.css'
import './cookie-consent-theme.css'
import { publicPagePath } from './publicPages/pages'

// Mounted once at the app root. mode: 'opt-in' (the library default) means nothing
// beyond strictly-necessary cookies is ever considered accepted until the visitor
// makes a choice, and the modal auto-shows on any page until they do.
//
// This library has its own `language.translations` config (not routed
// through react-i18next's t()) — it's plain JS invoked once outside
// React's render cycle, not a component. All 5 languages are provided
// up front; switching the active app language calls its own
// CookieConsent.setLanguage() below rather than re-running `run()`.
export function CookieConsentBanner() {
  const { i18n } = useTranslation()

  useEffect(() => {
    const privacyLink = `<a href="${publicPagePath('privacy-policy')}" class="cc__link">privacy policy</a>`

    CookieConsent.run({
      guiOptions: {
        consentModal: { layout: 'bar inline', position: 'bottom', equalWeightButtons: true },
        preferencesModal: { layout: 'box', position: 'right', equalWeightButtons: true },
      },
      categories: {
        necessary: {
          readOnly: true,
          enabled: true,
        },
        analytics: {
          enabled: false,
        },
      },
      language: {
        default: i18n.language,
        translations: {
          en: {
            consentModal: {
              title: 'We keep this simple',
              description: `We use only the cookies needed to run the site — nothing tracks you across it. Full details in our ${privacyLink}.`,
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Necessary only',
              showPreferencesBtn: 'Manage preferences',
            },
            preferencesModal: {
              title: 'Cookie preferences',
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Necessary only',
              savePreferencesBtn: 'Save preferences',
              closeIconLabel: 'Close',
              sections: [
                {
                  title: 'Strictly necessary',
                  description:
                    "Required for the site to work — remembering your theme and this cookie choice. These can't be turned off.",
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analytics',
                  description:
                    "Not in use today. Reserved here in case we ever add privacy-respecting analytics — you'd be asked to opt in, never opted in by default.",
                  linkedCategory: 'analytics',
                },
                {
                  title: 'More information',
                  description: `See our ${privacyLink} for what we collect and your rights under GDPR.`,
                },
              ],
            },
          },
          sv: {
            consentModal: {
              title: 'Vi håller det enkelt',
              description: `Vi använder endast de cookies som krävs för att driva webbplatsen — inget spårar dig över den. Fullständiga detaljer i vår ${privacyLink}.`,
              acceptAllBtn: 'Acceptera alla',
              acceptNecessaryBtn: 'Endast nödvändiga',
              showPreferencesBtn: 'Hantera inställningar',
            },
            preferencesModal: {
              title: 'Cookie-inställningar',
              acceptAllBtn: 'Acceptera alla',
              acceptNecessaryBtn: 'Endast nödvändiga',
              savePreferencesBtn: 'Spara inställningar',
              closeIconLabel: 'Stäng',
              sections: [
                {
                  title: 'Absolut nödvändiga',
                  description:
                    'Krävs för att webbplatsen ska fungera — kommer ihåg ditt tema och detta cookie-val. Dessa kan inte stängas av.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analys',
                  description:
                    'Används inte idag. Reserverad här om vi någonsin lägger till integritetsvänlig analys — du skulle bli tillfrågad om att delta, aldrig automatiskt inkluderad.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Mer information',
                  description: `Se vår ${privacyLink} för vad vi samlar in och dina rättigheter enligt GDPR.`,
                },
              ],
            },
          },
          da: {
            consentModal: {
              title: 'Vi holder det enkelt',
              description: `Vi bruger kun de cookies, der er nødvendige for at drive siden — intet sporer dig på tværs af den. Fulde detaljer i vores ${privacyLink}.`,
              acceptAllBtn: 'Accepter alle',
              acceptNecessaryBtn: 'Kun nødvendige',
              showPreferencesBtn: 'Administrer præferencer',
            },
            preferencesModal: {
              title: 'Cookie-indstillinger',
              acceptAllBtn: 'Accepter alle',
              acceptNecessaryBtn: 'Kun nødvendige',
              savePreferencesBtn: 'Gem præferencer',
              closeIconLabel: 'Luk',
              sections: [
                {
                  title: 'Strengt nødvendige',
                  description:
                    'Nødvendige for, at siden fungerer — husker dit tema og dette cookie-valg. Disse kan ikke slås fra.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analyse',
                  description:
                    'Ikke i brug i dag. Reserveret her, hvis vi nogensinde tilføjer privatlivsvenlig analyse — du ville blive bedt om at tilmelde dig, aldrig tilmeldt som standard.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Mere information',
                  description: `Se vores ${privacyLink} for, hvad vi indsamler, og dine rettigheder under GDPR.`,
                },
              ],
            },
          },
          nb: {
            consentModal: {
              title: 'Vi holder det enkelt',
              description: `Vi bruker kun informasjonskapslene som trengs for å drive nettstedet — ingenting sporer deg på tvers av det. Fullstendige detaljer i vår ${privacyLink}.`,
              acceptAllBtn: 'Godta alle',
              acceptNecessaryBtn: 'Kun nødvendige',
              showPreferencesBtn: 'Administrer innstillinger',
            },
            preferencesModal: {
              title: 'Informasjonskapsel-innstillinger',
              acceptAllBtn: 'Godta alle',
              acceptNecessaryBtn: 'Kun nødvendige',
              savePreferencesBtn: 'Lagre innstillinger',
              closeIconLabel: 'Lukk',
              sections: [
                {
                  title: 'Strengt nødvendige',
                  description:
                    'Nødvendige for at nettstedet skal fungere — husker temaet ditt og dette informasjonskapselvalget. Disse kan ikke slås av.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analyse',
                  description:
                    'Ikke i bruk i dag. Reservert her i tilfelle vi noen gang legger til personvernvennlig analyse — du ville blitt spurt om å delta, aldri automatisk inkludert.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Mer informasjon',
                  description: `Se vår ${privacyLink} for hva vi samler inn og dine rettigheter under GDPR.`,
                },
              ],
            },
          },
          fi: {
            consentModal: {
              title: 'Pidämme tämän yksinkertaisena',
              description: `Käytämme vain sivuston toimintaan tarvittavia evästeitä — mikään ei seuraa sinua sivustolla. Täydet tiedot ${privacyLink}.`,
              acceptAllBtn: 'Hyväksy kaikki',
              acceptNecessaryBtn: 'Vain välttämättömät',
              showPreferencesBtn: 'Hallitse asetuksia',
            },
            preferencesModal: {
              title: 'Evästeasetukset',
              acceptAllBtn: 'Hyväksy kaikki',
              acceptNecessaryBtn: 'Vain välttämättömät',
              savePreferencesBtn: 'Tallenna asetukset',
              closeIconLabel: 'Sulje',
              sections: [
                {
                  title: 'Ehdottoman välttämättömät',
                  description:
                    'Vaaditaan sivuston toimimiseksi — muistaa teemasi ja tämän evästevalinnan. Näitä ei voi poistaa käytöstä.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analytiikka',
                  description:
                    'Ei käytössä tällä hetkellä. Varattu tähän siltä varalta, että lisäämme joskus yksityisyyttä kunnioittavaa analytiikkaa — sinulta kysyttäisiin suostumusta, et olisi koskaan mukana oletuksena.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Lisätietoja',
                  description: `Katso ${privacyLink}, mitä keräämme ja mitkä ovat oikeutesi GDPR:n mukaisesti.`,
                },
              ],
            },
          },
        },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once at mount only; language changes after mount go through setLanguage() below, not a re-run of the whole config
  }, [])

  // Reactive half: once the banner is initialized, switching the app's
  // language later (Preferences, or the public-site switcher) calls the
  // library's own setLanguage instead of re-running `run()` — `run()`
  // recreates the whole widget (and would re-show a dismissed banner).
  useEffect(() => {
    void CookieConsent.setLanguage(i18n.language, true)
  }, [i18n.language])

  return null
}

export function showCookiePreferences() {
  CookieConsent.showPreferences()
}
