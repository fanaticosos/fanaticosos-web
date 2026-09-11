const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLOT = /^\d{4}-\d{2}-\d{2}$/;
const INTERNATIONAL_PHONE = /^\+[0-9][0-9 ()-]*[0-9]$/;

function text(form, name, minimum, maximum) {
  const value = String(form.get(name) ?? "").trim();
  if (value.length < minimum || value.length > maximum) throw new Error(`invalid:${name}`);
  return value;
}

function isAdult(birthDate, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const [year, month, day] = birthDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
    || candidate.getTime() > today.getTime()
  ) return false;
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  return candidate.getTime() <= cutoff.getTime();
}

export function validateParticipationForm(form, today) {
  const result = {
    slotId: text(form, "streamSlot", 10, 10),
    fullName: text(form, "fullName", 2, 100),
    email: text(form, "email", 5, 254).toLowerCase(),
    phone: text(form, "phone", 8, 26),
    birthDate: text(form, "birthDate", 10, 10),
    bearsStory: text(form, "bearsStory", 40, 2000),
    songTitle: text(form, "songTitle", 1, 150),
    songArtist: text(form, "songArtist", 1, 150),
    songReason: text(form, "songReason", 15, 1200),
  };
  if (!SLOT.test(result.slotId)) throw new Error("invalid:streamSlot");
  if (!EMAIL.test(result.email)) throw new Error("invalid:email");
  const phoneDigits = result.phone.replace(/\D/g, "");
  if (!INTERNATIONAL_PHONE.test(result.phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
    throw new Error("invalid:phone");
  }
  if (!isAdult(result.birthDate, today)) throw new Error("invalid:birthDate");
  for (const consent of ["rulesAccepted", "privacyAccepted", "publicationAccepted", "requestAcknowledged"]) {
    if (form.get(consent) !== "on") throw new Error(`invalid:${consent}`);
  }
  return result;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export async function verifyTurnstile({ secret, token, remoteIp, fetchImplementation = fetch }) {
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetchImplementation("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && (!result.action || result.action === "participa");
}

async function sendBrevoMessage(apiKey, message, fetchImplementation) {
  const response = await fetchImplementation("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`Brevo HTTP ${response.status}`);
  return response.json();
}

export async function sendParticipationEmails({ env, request, slot, requestId, fetchImplementation = fetch }) {
  const safe = Object.fromEntries(Object.entries(request).map(([key, value]) => [key, escapeHtml(value)]));
  const date = escapeHtml(slot.stream_date);
  const preparation = `<h2>Qué debes preparar</h2><ol><li>Haber visto los partidos indicados.</li><li>Seguir FanaticOSOS y estar suscrito al podcast, YouTube y/o Facebook.</li><li>Haber escuchado o visto streams anteriores.</li><li>Esperar la confirmación definitiva antes de reservar la fecha.</li><li>Preparar:<ol type="a"><li>Tu historia de cómo te volviste fan de los Chicago Bears.</li><li>Qué canción quieres compartir con los demás y por qué.</li></ol></li></ol><h2>Reglas de etiqueta para el podcast FanaticOSOS</h2><ol><li>Asegúrate de tener una buena conexión a internet. Las computadoras son preferibles a los dispositivos móviles porque tienen una mejor antena Wi-Fi.</li><li>Revisa el micrófono tantas veces como sea necesario y asegúrate de que funcione correctamente.</li><li>Es necesario estar en un lugar sin ruido. Como en el cine, los ruidos externos no son bienvenidos y hacen el podcast menos disfrutable.</li><li>Sé puntual; es importante respetar el tiempo de todos.</li><li>Hidrátate antes de iniciar el podcast. No queremos transmitir ruidos de gargantas secas ni tragos de agua.</li><li>Prepara tu contenido. Revisa tus notas y apuntes antes de entrar al aire; es importante presentar ideas con hilo y elocuencia.</li><li>Procura no ser monótono al usar tu voz. Recuerda que en el podcast la gente reacciona a sonidos, no a imágenes.</li><li>Promueve siempre el episodio.</li></ol>`;
  const sender = { name: "FanaticOSOS", email: env.BREVO_FROM_EMAIL };
  const participant = sendBrevoMessage(env.BREVO_API_KEY, {
    sender,
    to: [{ email: request.email, name: request.fullName }],
    replyTo: { email: env.PARTICIPATION_ADMIN_EMAIL, name: "FanaticOSOS" },
    subject: `Solicitud recibida: FanaticOSOS (${date})`,
    htmlContent: `<h1>Recibimos tu solicitud</h1><p>Hola ${safe.fullName}, solicitaste participar el <strong>${date} a las 8:00 p.m., hora de la Ciudad de México</strong>.</p><p>Esta solicitud no reserva automáticamente la fecha. FanaticOSOS te enviará una confirmación definitiva.</p><p><strong>Revisión:</strong> ${escapeHtml(slot.previous_game)}<br><strong>Próximo:</strong> ${escapeHtml(slot.next_game)}${slot.special_topic ? `<br><strong>Tema adicional:</strong> ${escapeHtml(slot.special_topic)}` : ""}</p>${preparation}<p>Folio: ${escapeHtml(requestId)}</p>`,
  }, fetchImplementation);
  const administrator = sendBrevoMessage(env.BREVO_API_KEY, {
    sender,
    to: [{ email: env.PARTICIPATION_ADMIN_EMAIL, name: "Administrador FanaticOSOS" }],
    replyTo: { email: request.email, name: request.fullName },
    subject: `[Nuevo invitado] ${date} — ${safe.fullName}`,
    htmlContent: `<h1>Nueva solicitud</h1><p><strong>Folio:</strong> ${escapeHtml(requestId)}<br><strong>Fecha:</strong> ${date}<br><strong>Nombre:</strong> ${safe.fullName}<br><strong>Email:</strong> ${safe.email}<br><strong>Teléfono:</strong> ${safe.phone}<br><strong>Nacimiento:</strong> ${safe.birthDate}</p><h2>Historia</h2><p>${safe.bearsStory}</p><h2>Canción</h2><p>${safe.songTitle} — ${safe.songArtist}</p><p>${safe.songReason}</p>`,
  }, fetchImplementation);

  const results = await Promise.allSettled([participant, administrator]);
  return {
    status: results.every((item) => item.status === "fulfilled") ? "sent" : results.some((item) => item.status === "fulfilled") ? "partial" : "failed",
    participantId: results[0].status === "fulfilled" ? results[0].value.messageId ?? null : null,
    adminId: results[1].status === "fulfilled" ? results[1].value.messageId ?? null : null,
  };
}

export async function sendDecisionEmail({ env, request, slot, decision, fetchImplementation = fetch }) {
  const confirmed = decision === "confirm";
  const response = await sendBrevoMessage(env.BREVO_API_KEY, {
    sender: { name: "FanaticOSOS", email: env.BREVO_FROM_EMAIL },
    to: [{ email: request.email, name: request.full_name }],
    replyTo: { email: env.PARTICIPATION_ADMIN_EMAIL, name: "FanaticOSOS" },
    subject: confirmed ? `Participación confirmada: FanaticOSOS (${slot.stream_date})` : `Actualización de tu solicitud: FanaticOSOS (${slot.stream_date})`,
    htmlContent: confirmed
      ? `<h1>Tu participación está confirmada</h1><p>Hola ${escapeHtml(request.full_name)}, reservamos el <strong>${escapeHtml(slot.stream_date)} a las 8:00 p.m., hora de la Ciudad de México</strong>.</p><p>Revisión: ${escapeHtml(slot.previous_game)}<br>Próximo: ${escapeHtml(slot.next_game)}</p><p>Agrega la fecha a tu calendario y prepara los partidos, tu historia y tu canción. Recuerda usar computadora, micrófono externo y un ambiente silencioso.</p>`
      : `<h1>Gracias por tu interés en participar</h1><p>Hola ${escapeHtml(request.full_name)}, muchas gracias por querer compartir tu historia con la comunidad de FanaticOSOS.</p><p>En esta ocasión no podremos confirmar tu participación para el <strong>${escapeHtml(slot.stream_date)}</strong>.</p><p>Esperamos contar contigo en otra oportunidad. Si lo deseas, puedes consultar las fechas disponibles y enviar una nueva solicitud.</p><p>Gracias por comprender y por ser parte de FanaticOSOS.</p>`,
  }, fetchImplementation);
  return response.messageId ?? null;
}
