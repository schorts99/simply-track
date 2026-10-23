import type { Language } from "../../../shared/i18n/language";

export type LegalDocument = "privacy" | "terms";
interface Section { heading: string; paragraphs?: string[]; items?: string[] }
interface Content { title: string; intro: string; sections: Section[] }
export const LEGAL_EFFECTIVE_DATE = "2026-10-22";

export function legalDetails() {
  return {
    operator: process.env.NEXT_PUBLIC_LEGAL_OPERATOR?.trim() || "",
    contact: process.env.NEXT_PUBLIC_LEGAL_CONTACT?.trim() || "",
    jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION?.trim() || "",
  };
}

export function legalContent(document: LegalDocument, language: Language): Content {
  const { operator, contact, jurisdiction } = legalDetails();
  const es = language === "es";
  const who = operator || (es ? "el operador de esta instalación de SimplyTrack" : "the operator of this SimplyTrack deployment");
  const responsible = operator ? (es ? ` ${operator} es responsable de esta instalación.` : ` ${operator} is responsible for this deployment.`) : "";
  const reach = contact
    ? (es ? `Puedes contactar a ${who} en ${contact}.` : `You can contact ${who} at ${contact}.`)
    : (es ? `Usa los datos de contacto publicados por ${who}.` : `Use the contact details published by ${who}.`);
  const law = jurisdiction
    ? (es ? `Estos términos se rigen por las leyes de ${jurisdiction}, salvo cuando la ley aplicable te otorgue derechos que no pueden limitarse.` : `These terms are governed by the laws of ${jurisdiction}, except where applicable law gives you rights that cannot be limited.`)
    : (es ? "Estos términos se rigen por la ley aplicable al operador y no limitan derechos que la ley te otorgue de forma obligatoria." : "These terms are governed by the law applicable to the operator and do not limit rights that the law gives you on a mandatory basis.");

  if (document === "privacy") return es ? {
    title: "Política de privacidad",
    intro: `SimplyTrack es una aplicación de finanzas personales que funciona primero en tu dispositivo. Esta política explica qué información usa la aplicación y dónde se guarda.${responsible}`,
    sections: [
      { heading: "Información que guardas", paragraphs: ["Puedes registrar transacciones, notas, presupuestos, metas, escenarios y preferencias personalizadas. Esta información se guarda en una base de datos SQLite cifrada con una clave derivada de tu contraseña. La aplicación no envía tus registros financieros a un servidor de SimplyTrack."] },
      { heading: "Almacenamiento en el dispositivo", items: ["El archivo cifrado se guarda en el almacenamiento privado del navegador (OPFS o IndexedDB).", "Mientras la bóveda está abierta, una clave de sesión no exportable y un token aleatorio permiten recargar sin volver a escribir la contraseña. Cerrar la pestaña o salir elimina ese acceso.", "El idioma y la apariencia se guardan en localStorage solo si los eliges. No contienen datos financieros.", "Las copias exportadas permanecen cifradas, pero quedan bajo tu control una vez descargadas."] },
      { heading: "Desbloqueo biométrico", paragraphs: ["Si lo activas, tu sistema operativo verifica tu huella, rostro o PIN mediante WebAuthn. SimplyTrack nunca recibe tus datos biométricos. Solo guarda en este dispositivo un identificador de credencial y una clave de bóveda envuelta que el autenticador puede desbloquear."] },
      { heading: "Google Drive opcional", paragraphs: ["Si conectas Google Drive, la aplicación guarda el mismo archivo cifrado en la carpeta privada de datos de aplicación de tu Drive. El token de acceso de Google se mantiene en memoria y no se guarda en el dispositivo. El uso de Google Drive también está sujeto a las políticas de Google."] },
      { heading: "Servicio y registros técnicos", paragraphs: ["SimplyTrack no incluye anuncios, analítica ni rastreadores de terceros. Al cargar la aplicación, el proveedor de alojamiento puede procesar datos técnicos como dirección IP, navegador y hora de la solicitud para entregar y proteger el servicio. Esos registros no incluyen el contenido de tu bóveda."] },
      { heading: "Tus decisiones", items: ["Puedes exportar, importar, sincronizar, bloquear o eliminar tus datos desde la configuración y desde las herramientas de tu navegador.", "Puedes desconectar Google Drive y revocar el acceso de la aplicación en tu cuenta de Google.", "No hay recuperación de contraseña: sin ella, nadie puede descifrar la bóveda."] },
      { heading: "Contacto y cambios", paragraphs: [`${reach} Si esta política cambia, se actualizará la fecha de vigencia en esta página.`] },
    ],
  } : {
    title: "Privacy Policy",
    intro: `SimplyTrack is a local-first personal finance app. This policy explains what information the app uses and where it is stored.${responsible}`,
    sections: [
      { heading: "Information you keep", paragraphs: ["You can record transactions, notes, budgets, goals, scenarios and personalized preferences. This information is stored in an SQLite database encrypted with a key derived from your password. The app does not send your financial records to a SimplyTrack server."] },
      { heading: "Device storage", items: ["The encrypted file is stored in the browser’s private storage (OPFS or IndexedDB).", "While the vault is open, a non-exportable session key and random token let you reload without retyping your password. Closing the tab or logging out removes that access.", "Language and appearance are saved in localStorage only when you choose them. They do not contain financial data.", "Exported backups remain encrypted, but are under your control once downloaded."] },
      { heading: "Biometric unlock", paragraphs: ["If enabled, your operating system checks your fingerprint, face or PIN through WebAuthn. SimplyTrack never receives biometric data. It only stores a credential identifier and a wrapped vault key on this device that the authenticator can unlock."] },
      { heading: "Optional Google Drive sync", paragraphs: ["If you connect Google Drive, the app stores the same encrypted file in your Drive’s private app-data folder. The Google access token stays in memory and is not saved on the device. Your use of Google Drive is also subject to Google’s policies."] },
      { heading: "Service and technical logs", paragraphs: ["SimplyTrack does not include advertising, analytics or third-party trackers. When the app loads, the hosting provider may process technical data such as IP address, browser and request time to deliver and protect the service. These logs do not include your vault contents."] },
      { heading: "Your choices", items: ["You can export, import, sync, lock or delete your data from settings and from your browser’s site-data tools.", "You can disconnect Google Drive and revoke the app’s access in your Google account.", "There is no password recovery: without it, no one can decrypt the vault."] },
      { heading: "Contact and changes", paragraphs: [`${reach} If this policy changes, the effective date on this page will be updated.`] },
    ],
  };

  return es ? {
    title: "Términos y condiciones",
    intro: `Estos términos regulan el uso de esta instalación de SimplyTrack, ofrecida por ${who}. Al usar la aplicación, aceptas estos términos.`,
    sections: [
      { heading: "Uso de SimplyTrack", paragraphs: ["Puedes usar SimplyTrack para organizar tus finanzas personales. No debes usarlo para actividades ilegales, para dañar el servicio ni para acceder a datos de otras personas sin autorización."] },
      { heading: "Tu bóveda y tu contraseña", items: ["Eres responsable de tu contraseña, tus dispositivos y tus copias de seguridad.", "La contraseña no puede recuperarse. Si la pierdes, también puedes perder el acceso a tus datos.", "Antes de resolver un conflicto de sincronización o importar una copia, revisa qué versión deseas conservar."] },
      { heading: "Sin asesoría financiera", paragraphs: ["Los presupuestos, pronósticos y escenarios son estimaciones basadas en la información que proporcionas. SimplyTrack no ofrece asesoría financiera, fiscal, legal ni de inversión."] },
      { heading: "Servicios de terceros", paragraphs: ["Google Drive y las funciones biométricas dependen de tu navegador, dispositivo y proveedores externos. Su uso también está sujeto a sus propios términos, y pueden no estar disponibles en todos los entornos."] },
      { heading: "Disponibilidad y responsabilidad", paragraphs: ["El servicio se ofrece tal como está y según disponibilidad. Se procura protegerlo y mantenerlo útil, pero no se garantiza que esté libre de errores o interrupciones. En la medida permitida por la ley, el operador no es responsable de pérdidas indirectas ni de decisiones tomadas a partir de estimaciones de la aplicación."] },
      { heading: "Cambios y ley aplicable", paragraphs: [`Estos términos pueden actualizarse; los cambios se publicarán en esta página con una nueva fecha de vigencia. ${law}`] },
      { heading: "Contacto", paragraphs: [reach] },
    ],
  } : {
    title: "Terms and Conditions",
    intro: `These terms govern your use of this SimplyTrack deployment, provided by ${who}. By using the app, you agree to these terms.`,
    sections: [
      { heading: "Using SimplyTrack", paragraphs: ["You may use SimplyTrack to organize your personal finances. Do not use it for unlawful activity, to harm the service, or to access other people’s data without permission."] },
      { heading: "Your vault and password", items: ["You are responsible for your password, devices and backups.", "Passwords cannot be recovered. If you lose yours, you may lose access to your data.", "Before resolving a sync conflict or importing a backup, check which version you want to keep."] },
      { heading: "No financial advice", paragraphs: ["Budgets, forecasts and scenarios are estimates based on information you provide. SimplyTrack does not provide financial, tax, legal or investment advice."] },
      { heading: "Third-party services", paragraphs: ["Google Drive and biometric features depend on your browser, device and outside providers. Their use is also subject to their own terms, and they may not be available in every environment."] },
      { heading: "Availability and liability", paragraphs: ["The service is provided as is and as available. Reasonable care is taken to keep it secure and useful, but it is not guaranteed to be error-free or uninterrupted. To the extent permitted by law, the operator is not liable for indirect losses or decisions made from the app’s estimates."] },
      { heading: "Changes and governing law", paragraphs: [`These terms may be updated; changes will be posted on this page with a new effective date. ${law}`] },
      { heading: "Contact", paragraphs: [reach] },
    ],
  };
}
