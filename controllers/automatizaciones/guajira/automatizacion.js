import dotenv from "dotenv";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import axios from "axios";
import { transformarAutorizacionesGuajira, transformarAutorizacionesEsperanza } from "../../../utils/excel/transformarAutorizaciones.js";
import { generarExcelBuffer } from "../../../utils/excel/escribirExcel.js";
import moment from "moment-timezone";
import { leerExcelDesdeBuffer } from "../../../utils/excel/leerExcel.js";

dotenv.config();

const normalizar = (str) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const MOZART_BASE_URL = "https://api.salud.mozartai.com.co";
const QRYSTALOS_BASE_URL = "https://qrystalos.com";
const QRYSTALOS_ORGANIZACION = "Clinica + Esperanza";

let browser, page, session; 
let contextGlobal;
let pageMozartia;

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});


/* ======================
   HELPERS: EXTRAER-Sesion + PATIENT-INFO + APPOINTMENT
====================== */

const extraerSesionMozart = async (page, tenant) => {
  const tenantToken = await page.evaluate(() => {
    return localStorage.getItem("tenantToken");
  });

  if (!tenantToken) {
    throw new Error(
      "No se encontró 'tenantToken' en localStorage. Verifica que el login haya sido exitoso antes de llamar esta función."
    );
  }

  return {
    authorization: `Bearer ${tenantToken}`
  };
};

const obtenerPacienteId = async (tenant, identificacion) => {
  const { data } = await axios.post(
    `${MOZART_BASE_URL}/api/external/patient-info`,
    { tenant, identificacion },
    {
      headers: {
        "x-api-key": process.env.MOZART_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  const pacienteId = data?.data?.paciente?.id;

  if (!data?.success || !pacienteId) {
    throw new Error("No se encontró pacienteId en la respuesta de patient-info");
  }

  return pacienteId;
};

const crearCitaPendiente = async ({ tenant, pacienteId, servicio, sesionMozart }) => {
  const { data } = await axios.post(
    `${MOZART_BASE_URL}/api/tenant/appointments`,
    {
      duracion: 30,
      especialidad: servicio,
      motivo: `Servicio CUPS: ${servicio}`,
      pacienteId,
      tipo: "Presencial",
      tenant,
    },
    {
      headers: {
        "authorization": sesionMozart.authorization,
        "X-Tenant": tenant,
        "Content-Type": "application/json",
      },
    }
  );

  return data;
};

const crearCitaParaPersona = async (tenant, persona, sesionMozart) => {
  try {
    const pacienteId = await obtenerPacienteId(tenant, persona.cedula);
    const cita = await crearCitaPendiente({
      tenant,
      pacienteId,
      servicio: persona.servicio,
      sesionMozart,
    });

    return { cedula: persona.cedula, nombre: persona.nombre, ok: true, cita };
  } catch (error) {
    const mensajeError = error.response?.data?.message || error.message;
    console.error(`❌ Error creando cita para ${persona.cedula}:`, mensajeError);
    return { cedula: persona.cedula, nombre: persona.nombre, ok: false, error: mensajeError };
  }
};






const detectarSesionExpiradaGuajira = async (page) => {
  try {
    // Esperar un momento a que la página estabilice
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log("🔎 URL actual:", currentUrl);

    // 1️⃣ Si estamos en login, la sesión expiró
    if (currentUrl.includes("/sso/login")) {
      console.log("⚠️ Detectado login por URL");
      return true;
    }

    // 2️⃣ Si existe el input de usuario, también es login
    const inputUsuario = page.locator("input[name='username']");
    if (await inputUsuario.count() > 0) {
      console.log("⚠️ Detectado formulario de login por selector");
      return true;
    }

    // 3️⃣ Buscar mensaje explícito de sesión expirada
    const textoExpirado = await page.locator("text=/sesión.*expirada/i").count();
    if (textoExpirado > 0) {
      console.log("⚠️ Detectado mensaje de sesión expirada");
      return true;
    }

    // 4️⃣ Validar que realmente estamos dentro del módulo correcto
    const estaEnValidador = currentUrl.includes("ValidacionDerechos");
    if (estaEnValidador) {
      console.log("✅ Sesión activa");
      return false;
    }

    // 5️⃣ Fallback defensivo
    console.log("⚠️ Estado incierto, asumiendo sesión expirada por seguridad");
    return true;

  } catch (error) {
    console.error("Error detectando sesión:", error);
    return true; // por seguridad, forzar renovación
  }
};


const detectarSesionExpiradaCristal = async (page) => {
  try {
    await page.waitForLoadState("domcontentloaded");

    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {
      console.log("⏱️ networkidle no alcanzado, continuando...");
    });

    const currentUrl = page.url();
    console.log("🔎 URL actual:", currentUrl);

    // 1️⃣ Si está en login, sesión expiró
    if (currentUrl.includes("/autenticarse")) {
      console.log("⚠️ Detectado login por URL");
      return true;
    }

    // 2️⃣ Si está en el módulo correcto, sesión activa
    if (currentUrl.includes("/ce")) {
      console.log("✅ Sesión activa por URL");
      return false;
    }

    // 3️⃣ Solo si la URL es ambigua, revisar DOM en paralelo
    const [tieneUsuario, tieneClave, tieneMensaje] = await Promise.all([
      page.locator('input[aria-label="Usuario *"]').count(),
      page.locator('input[aria-label="Clave Secreta *"]').count(),
      page.locator('text=Su sesión ha expirado').count(),
    ]);

    if (tieneUsuario > 0 || tieneClave > 0 || tieneMensaje > 0) {
      console.log("⚠️ Detectado formulario de login por DOM");
      return true;
    }

    // 4️⃣ Fallback defensivo
    console.log("⚠️ Estado incierto, asumiendo sesión expirada");
    return true;

  } catch (error) {
    console.error("Error detectando sesión:", error);
    return true;
  }
};

async function seleccionarCita(page, fecha, hora) {
  const fechaHora = `${fecha} ${hora}`;
  await page.waitForTimeout(2000);

  while (true) {
    await page.waitForSelector('.q-table tbody tr.q-tr', { timeout: 2000 });

    // Buscar la celda de fecha que contenga el texto exacto
    const celdaFecha = page.locator('.q-table tbody tr.q-tr td', {
      hasText: fechaHora
    }).first();

    if (await celdaFecha.count() > 0) {
      // Subir al <tr> padre y hacer click
      const filaParent = celdaFecha.locator('xpath=..');
      await filaParent.scrollIntoViewIfNeeded();
      await filaParent.click();
      console.log("✅ Cita encontrada:", fechaHora);
      return true;
    }

    const botonSiguiente = page.locator(
      'button[aria-label="Próxima página"]:not([disabled])'
    );

    if (await botonSiguiente.count() === 0) {
      console.log("❌ No se encontró la cita:", fechaHora);
      return false;
    }

    console.log("➡️ Pasando a la siguiente página");
    await botonSiguiente.click();
    await page.waitForTimeout(1000);
  }
}


export const AutorizacionGuajira = async (req, res) => {
  const { documento, tipoDocumento, tenant } = req.body;

  const profileId = process.env.profileIdGuajiraVALIDOR
  const usuario = process.env.USUARIOGUAJIRAVALIDOR
  const clave = process.env.CLAVEGUAJIRAVALIDOR

  let session, browser, page;
  const cupsPermitidos = new Set([
    "61002", "61302", "401101", "542402", "586102", "601101",
    "641201", "832102", "851101", "851102", "860101", "860102",
    "870001", "870003", "870004", "870005", "870006", "870007",
    "870101", "870102", "870103", "870104", "870105", "870107",
    "870108", "870112", "870113", "870131", "870601", "870602",
    "870603", "871010", "871019", "871020", "871030", "871040",
    "871050", "871060", "871061", "871062", "871070", "871091",
    "871111", "871112", "871121", "871129", "871208", "871320",
    "872002", "872011", "872101", "872102", "872103", "872104",
    "872105", "872121", "872122", "872123", "873001", "873002",
    "873003", "873004", "873111", "873112", "873121", "873122",
    "873204", "873205", "873206", "873210", "873302", "873305",
    "873306", "873311", "873312", "873313", "873314", "873333",
    "873335", "873340", "873411", "873420", "873423", "873431",
    "873443", "873444", "876801", "876802", "879111", "879112",
    "879113", "879116", "879121", "879122", "879131", "879132",
    "879150", "879161", "879162", "879201", "879205", "879301",
    "879410", "879420", "879421", "879430", "879460", "879510",
    "879520", "879522", "879523", "879910", "879990", "881112",
    "881130", "881131", "881132", "881141", "881151", "881201",
    "881211", "881212", "881301", "881302", "881305", "881306",
    "881313", "881332", "881360", "881362", "881401", "881402",
    "881403", "881431", "881432", "881434", "881435", "881436",
    "881437", "881501", "881510", "881511", "881601", "881602",
    "881610", "881611", "881612", "881613", "881620", "881621",
    "881622", "881630", "881640", "881701", "882112", "882132",
    "882203", "882212", "882222", "882232", "882242", "882252",
    "882298", "882307", "882308", "882309", "882316", "882317",
    "882318", "882602", "882603", "891401", "891410", "891901",
    "894102", "895001", "895100", "895101", "951302", "1005927",
    "751101", "881438", "881439", "897011"
  ]);

  const URL_PORTAL =
    "https://portal.colsanitas.com/sso/login?service=https%3A%2F%2Fappcore.colsanitas.com%2FValidadorDerechos%2Fpages%2Fgestion%2FValidacionDerechos.seam%3Fcid%3D2349";

  try {
        session = await client.sessions.create({
          acceptCookies: true,
          saveDownloads: true,
          profile: { id: profileId, persistChanges: false },
        });

        browser = await chromium.connectOverCDP(session.wsEndpoint);
        page = browser.contexts()[0].pages()[0];

        await page.goto(URL_PORTAL, { waitUntil: "networkidle" });

        const sesionExpirada = await detectarSesionExpiradaGuajira(page);
        if (sesionExpirada) {
          await browser.close();
          await client.sessions.stop(session.id);
          await new Promise((r) => setTimeout(r, 2000));

          session = await client.sessions.create({
            acceptCookies: true,
            saveDownloads: true,
            profile: { id: profileId, persistChanges: true },
          });

          browser = await chromium.connectOverCDP(session.wsEndpoint);
          page = browser.contexts()[0].pages()[0];

          await page.goto(URL_PORTAL);
          await page.fill("input[name='username']", usuario);
          await page.waitForTimeout(1000);
          await page.fill("input[name='password']", clave);
          await page.waitForTimeout(1000);
          await page.locator("input[type='submit'][value='Ingresar']").click({ force: true });
          await page.waitForTimeout(5000);
        }

        await page.locator("label", { hasText: "Tipo y Num Identificación" }).waitFor({ state: "visible", timeout: 90000 });
        await page.locator("label", { hasText: "Tipo y Num Identificación" }).click();
        await page.waitForTimeout(2000);
        await page.locator("#formaVDGeneral\\:selectOneTipoDoc").selectOption({ label: tipoDocumento });
        await page.waitForTimeout(2000);
        await page.fill("#formaVDGeneral\\:numDocumento", documento);
        await page.waitForTimeout(1000);
        await page.locator("#formaVDGeneral\\:j_id77").click();
        await page.waitForTimeout(3000);

        await page.locator("#formaVDGeneral\\:selectOneCiaId").selectOption({ label: "Todas" });
        await page.waitForTimeout(1000);

        const opciones = page.locator("#formaVDGeneral\\:selectOnePlanFam label");
        let tipoEntidad = null;

        for (let i = 0; i < (await opciones.count()); i++) {
          const texto = await opciones.nth(i).innerText();
          if (texto.includes("EPS") || texto.includes("COLSANITAS") || texto.includes("COOMEVA")) {
            tipoEntidad = texto.includes("EPS") ? "EPS" : texto.includes("COLSANITAS") ? "COLSANITAS" : "COOMEVA";
            await opciones.nth(i).click();
            break;
          }
        }

        if (!tipoEntidad) throw new Error("Entidad no reconocida (EPS/COLSANITAS/COOMEVA)");

        await page.locator("#formaVDGeneral\\:btnConsultarUsuario").click();
        await page.waitForSelector("#info-usuario", { timeout: 30000 });

        const datosUsuario = await page.evaluate(() => {
          const c = document.querySelector("#info-usuario");
          const val = (label) =>
            Array.from(c.querySelectorAll("label"))
              .find((l) => l.innerText.includes(label))
              ?.parentElement.querySelector(".info-dato")
              ?.innerText.trim() ?? null;
          return {
            nombre: c.querySelector("h2")?.innerText.trim() ?? null,
            estado: val("Estado"),
          };
        });

        const esActivo = ["ACTIVO", "VIGENTE"].includes(datosUsuario.estado?.toUpperCase());
        const nombreFormateado = datosUsuario.nombre
          ?.split(/[,|_]/)                       
          .map(word => word.trim())              
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(" ");                        

        const filaTabla = {
          cedula:             documento,
          nombres:            nombreFormateado,
          motivo:             "",
        };

        if (!esActivo) {
          filaTabla.motivo = "Paciente inactivo";
          filaTabla.puedeAgendar = false;

        } else if (tipoEntidad === "COLSANITAS" || tipoEntidad === "COOMEVA") {
          filaTabla.puedeAgendar = true;

        } else if (tipoEntidad === "EPS") {
          await page.locator("label", { hasText: "Servicios con Autorización" }).waitFor({ state: "visible", timeout: 90000 });
          await page.locator("label", { hasText: "Servicios con Autorización" }).click();
          await page
            .locator("#formaVDGeneral\\:servicios\\:includeSeleccionUsuario\\:formaSeleccionUsuario\\:continuarPaso0")
            .click();
          await page.waitForTimeout(5000);

          const mensajeNoAutorizacion = await page.locator(
            "#formaVDGeneral\\:servicios\\:includeSeleccionUsuario\\:formaSeleccionUsuario .rich-messages-label"
          ).elementHandles();

          if (mensajeNoAutorizacion.length > 0) {
            const texto = await mensajeNoAutorizacion[0].innerText();
            if (texto.includes("El usuario no tiene volantes expedidos")) {
              filaTabla.motivo = "No tiene autorizaciones expedidas para el prestador";
              filaTabla.puedeAgendar = false;
            }
          } else {
            await page.waitForSelector(
              "#formaVDGeneral\\:servicios\\:includeInformacionServicio\\:frm\\:includeRegistroAdmisionVolantes\\:frm\\:formaConsultaVolantes\\:detListPrest",
              { timeout: 30000 }
            );

            const autorizaciones = await page.evaluate(() => {
              const tbody = document.querySelector(
                "#formaVDGeneral\\:servicios\\:includeInformacionServicio\\:frm\\:includeRegistroAdmisionVolantes\\:frm\\:formaConsultaVolantes\\:detListPrest\\:tb"
              );
              if (!tbody) return [];

              return Array.from(tbody.querySelectorAll("tr.rich-table-row")).map((fila) => {
                const celdas    = fila.querySelectorAll("td");
                const subFila   = fila.nextElementSibling?.classList.contains("rich-subtable-row")
                  ? fila.nextElementSibling : null;
                const celdasSub = Array.from(subFila?.querySelectorAll("td") || []);

                return {
                  numeroAutorizacion: celdas[1]?.innerText.trim(),
                  fechaVigencia:      celdas[4]?.innerText.trim(),
                  fechaAprobacion:    celdas[3]?.innerText.trim(),
                  estado:             celdas[5]?.innerText.trim(),
                  prestador:          celdas[6]?.innerText.trim(),
                  codigo:             celdasSub[1]?.innerText.trim(),
                  descripcion:        celdasSub[2]?.innerText.trim(),
                };
              });
            });

            const hoy = moment().tz("America/Bogota").startOf("day");

            const autorizacionesValidas = autorizaciones.filter((a) =>
              a.estado?.toUpperCase() === "APROBADA" &&
              a.prestador?.toUpperCase().includes("CLINICA ESPERANZA SAS") &&
              cupsPermitidos.has(a.codigo?.toUpperCase()) &&
              moment
                .tz(a.fechaVigencia, "DD/MM/YYYY", "America/Bogota")
                .endOf("day")
                .isSameOrAfter(hoy)
            );

            if (!autorizacionesValidas.length) {
              filaTabla.motivo = "No tiene autorizaciones válidas para CLINICA ESPERANZA SAS";
              filaTabla.puedeAgendar = false;
            } else {
              filaTabla.puedeAgendar = true;

              // Iterar sobre TODAS las autorizaciones válidas
              const autorizacionesConDetalle = [];

              for (const aut of autorizacionesValidas) {
                const autBase = {
                  fechaAutorizacion: aut.fechaAprobacion,
                  fechaExpedicion: aut.fechaVigencia, //CAMBIO
                  servicio: `${aut.codigo} - ${aut.descripcion}`,
                  numeroAutorizacion: aut.numeroAutorizacion,
                  numeroRadicacion: aut.numeroAutorizacion,
                };

                // Encontrar el índice real de esta autorización en la tabla original
                const indiceReal = autorizaciones.findIndex(
                  (a) => a.numeroAutorizacion === aut.numeroAutorizacion
                );

                if (indiceReal === -1) {
                  autorizacionesConDetalle.push(autBase);
                  continue;
                }

                try {
                  // Abrir modal de detalles
                  await page.locator("a", { hasText: "Mostrar" }).nth(indiceReal).click();
                  await page.waitForSelector("#buscandoDetalle", { state: "hidden", timeout: 30000 });
                  await page.waitForTimeout(2000);

                  const infoModal = await page.evaluate(() => {
                    const contenedor = document.querySelector(
                      "#formaVDGeneral\\:servicios\\:includeInformacionServicio\\:frm\\:includeRegistroAdmisionVolantes\\:frm\\:formaConsultaVolantes\\:detalle-volanteContentDiv"
                    );
                    if (!contenedor) return null;

                    const style = window.getComputedStyle(contenedor.parentElement.parentElement);
                    if (style.display === "none") return null;

                    const tabla = contenedor.querySelector("#tablaDetalleVolante");
                    if (!tabla) return null;

                    const datos = {};
                    const filas = tabla.querySelectorAll("tbody > tr");

                    for (let fila of filas) {
                      const celdas = fila.querySelectorAll("td");
                      if (celdas.length === 2 && !celdas[0].hasAttribute("colspan")) {
                        const label = celdas[0].textContent.trim();
                        const valor = celdas[1].textContent.trim();
                        if (label === "Lugar") datos.modalidad = valor;
                        else if (label === "Prestador que ordena:") datos.prestador = valor;
                      }
                    }

                    const obsCodif = [];
                    const tablaObsCodif = contenedor.querySelector("#tablaDetalleVolObsCodif tbody");
                    if (tablaObsCodif) {
                      tablaObsCodif.querySelectorAll("tr").forEach((tr) => {
                        const celdas = tr.querySelectorAll("td");
                        if (celdas.length === 2) {
                          obsCodif.push({
                            codigo: celdas[0].textContent.trim(),
                            observacion: celdas[1].textContent.trim(),
                          });
                        }
                      });
                    }

                    datos.observacionesCodificadas = obsCodif;
                    return datos;
                  });

                  if (infoModal) {
                    autBase.modalidad = infoModal.modalidad;
                    autBase.prestadorQueOrdena = infoModal.prestador;
                    autBase.observacionesCodificadas = infoModal.observacionesCodificadas;
                  }

                  // Cerrar modal
                  await page.evaluate(() => {
                    const modal = document.getElementById(
                      "formaVDGeneral:servicios:includeInformacionServicio:frm:includeRegistroAdmisionVolantes:frm:formaConsultaVolantes:detalle-volante"
                    );
                    if (modal?.component) modal.component.hide();
                  });
                  await page.waitForTimeout(1500);

                  // Click en Seleccionar usando el índice real
                  await page.locator(
                    `#formaVDGeneral\\:servicios\\:includeInformacionServicio\\:frm\\:includeRegistroAdmisionVolantes\\:frm\\:formaConsultaVolantes\\:detListPrest\\:${indiceReal}\\:linkSeleccionarVol2`
                  ).click();

                  await page.waitForSelector(
                    "#formaVDGeneral\\:servicios\\:includeInformacionServicio\\:frm\\:includeRegistroAdmisionVolantes\\:frm\\:formaConsultaVolantes\\:selectCausaExterna",
                    { state: "visible", timeout: 30000 }
                  );
                  await page.waitForTimeout(2000);

                  const infoRips = await page.evaluate(() => {
                    const getSelectedText = (id) => {
                      const el = document.getElementById(id);
                      return el?.options[el.selectedIndex]?.text?.trim() ?? null;
                    };
                    const p = "formaVDGeneral:servicios:includeInformacionServicio:frm:includeRegistroAdmisionVolantes:frm:formaConsultaVolantes:";
                    const diagTabla = document.querySelector("#diagnosticoContainer tbody tr");

                    return {
                      causaExterna:         getSelectedText(p + "selectCausaExterna"),
                      grupoServicio:        getSelectedText(p + "selectGroupService"),
                      modalidadAtencion:    getSelectedText(p + "selectModeOfCare"),
                      finalidad:            getSelectedText(p + "selectFinalidad"),
                      diagnosticoPrincipal: {
                        codigo:      diagTabla?.querySelector("td:nth-child(1)")?.innerText?.trim() ?? null,
                        descripcion: diagTabla?.querySelector("td:nth-child(2)")?.innerText?.trim() ?? null,
                      },
                    };
                  });

                  if (infoRips) {
                    autBase.rips = infoRips;
                  }

                } catch (err) {
                  console.warn(`⚠️ Error extrayendo detalle de autorización ${aut.numeroAutorizacion}:`, err.message);
                }

                autorizacionesConDetalle.push(autBase);
              }

              filaTabla.autorizaciones = autorizacionesConDetalle;
            }
          }
        }

        // console.log("✅ Fila lista para la tabla:", JSON.stringify(filaTabla, null, 2));

        const filasExcel = transformarAutorizacionesGuajira(filaTabla);
        if (filaTabla.puedeAgendar) {
          const buffer = generarExcelBuffer(filasExcel);
          console.log("filas excel construido: ", filasExcel)

          const contextGlobal = browser.contexts()[0];
          const pageMozartia = await contextGlobal.newPage();

          await pageMozartia.goto(`https://salud.mozartai.com.co/${tenant}/login`, {
            waitUntil: "networkidle",
          });

          // elegir email según tenant
          const emailMozart =
            tenant === "cemdiprueba"
              ? process.env.mozartEmailCemdiPrueba
              : process.env.mozartEmail;

          await pageMozartia
            .locator('input[name="email"]')
            .fill(emailMozart);
          await pageMozartia
            .locator('input[name="password"]')
            .fill(process.env.mozartPassword);
          await pageMozartia
            .getByRole("button", { name: /Acceder al Sistema/i })
            .click();

          await pageMozartia.waitForFunction(
            (tenant) => {
              return (
                location.pathname.startsWith(`/${tenant}`) ||
                location.pathname.startsWith("/medical-authorizations")
              );
            },
            tenant,
            { timeout: 60000 },
          );

          await pageMozartia.getByRole("button", { name: /Aceptar/i }).click();

          await pageMozartia.goto(
            `https://salud.mozartai.com.co/${tenant}/medical-authorizations`,
            { waitUntil: "networkidle" },
          );

          await pageMozartia
            .getByRole("button", {
              name: /Carga Masiva/i,
            })
            .waitFor({ state: "visible" });

          await pageMozartia
            .getByRole("button", {
              name: /Carga Masiva/i,
            })
            .click();

          const fileInput = pageMozartia.locator(
            'input[type="file"][accept*=".xlsx"]',
          );

          await fileInput.waitFor({ state: "visible" });

          await fileInput.setInputFiles({
            name: "autorizaciones.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer: buffer,
          });

          const cargarBtn = pageMozartia.getByRole("button", {
            name: /Cargar Archivo/i,
          });

          await pageMozartia
            .locator('button:not([disabled]):has-text("Cargar Archivo")')
            .waitFor({ state: "visible", timeout: 15000 });

          await cargarBtn.click();
          await page.waitForTimeout(2500);
          console.log("✅ Excel subido a Mozart");

        } else {
          console.log("⏭️ Paciente no puede agendar, se omite carga a Mozart:", filaTabla.motivo);
        }


        // if (sesionExpirada) await client.sessions.stop(session.id);

        console.log({
          documento,
          estado: "completado",
          puedeAgendar: filaTabla.puedeAgendar,
          motivo: filaTabla.motivo ?? "",
          datos: filaTabla,
        })

        return res.status(200).json({
          documento,
          estado: "completado",
          puedeAgendar: filaTabla.puedeAgendar,
          motivo: filaTabla.motivo ?? "",
          datos: filaTabla,
        });

      } catch (err) {
        console.error("❌ Error:", err.message);
        return res.status(500).json({
          documento,
          estado: "error",
          puedeAgendar: false,
          motivo: "Error al procesar la solicitud",
          error: err.message,
          timestamp: new Date().toISOString(),
      });
      
  } finally {
    console.log("🔒 Cerrando sesión Hyperbrowser...");
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.log("Error cerrando browser:", e.message);
    }
    try {
      if (session) await client.sessions.stop(session.id);
      console.log("✅ Sesión cerrada correctamente");
    } catch (e) {
      console.log("Error cerrando sesión:", e.message);
    }
  }
};


export const descargarAutorizacionEsperanza = async (req, res) => {
  const { tenant } = req.body;
  const archivosExcel = req.files;

  if (!archivosExcel || archivosExcel.length === 0) {
    return res.status(400).json({
      mensaje: "No se recibieron archivos Excel",
    });
  }

  try {
    session = await client.sessions.create({ acceptCookies: true });
    console.log("preview: ", session.liveUrl);

    browser = await chromium.connectOverCDP(session.wsEndpoint);
    const context = browser.contexts()[0];
    page = context.pages()[0];
    
    let dataTotal = [];

    for (const archivoExcel of archivosExcel) {
      const bufferExcel = archivoExcel.buffer;

      const dataOriginal = leerExcelDesdeBuffer(bufferExcel);

      const dataTransformada =
        transformarAutorizacionesEsperanza(dataOriginal);

      dataTotal.push(...dataTransformada);
    }

    if (dataTotal.length === 0) {
      return res.status(200).json({
        mensaje: "No se encontraron registros para subir",
        personas: [],
        total: 0,
      });
    }

    
    const personasSubidas = dataTotal.map((row) => ({
      cedula: row["Cédula *"],
      nombre: row["Nombres *"],
      servicio: row["Servicio *"],
      autorizacion: row["Número de Autorización"],
    }));

    const bufferTransformado = generarExcelBuffer(dataTotal);
    console.log("✅ Excel transformado generado en memoria");

    /* ======================
       LOGIN MOZART
    ====================== */
    contextGlobal = browser.contexts()[0];
    pageMozartia = await contextGlobal.newPage();

    await pageMozartia.goto(`https://salud.mozartai.com.co/${tenant}`, {
      waitUntil: "networkidle",
    });

    await pageMozartia
      .locator('input[name="email"]')
      .fill(process.env.mozartEmail);
    await pageMozartia
      .locator('input[name="password"]')
      .fill(process.env.mozartPassword);
    await pageMozartia
      .getByRole("button", { name: /Acceder al Sistema/i })
      .click();

    await pageMozartia.waitForFunction(
      (tenant) => {
        return (
          location.pathname.startsWith(`/${tenant}`) ||
          location.pathname.startsWith("/medical-authorizations")
        );
      },
      tenant,
      { timeout: 60000 }
    );

    await pageMozartia.getByRole("button", { name: /Aceptar/i }).click();

    const sesionMozart = await extraerSesionMozart(pageMozartia, tenant);

    await pageMozartia.goto(
      `https://salud.mozartai.com.co/${tenant}/medical-authorizations`,
      { waitUntil: "networkidle" }
    );

    await pageMozartia
      .getByRole("button", { name: /Carga Masiva/i })
      .waitFor({ state: "visible" });

    await pageMozartia
      .getByRole("button", { name: /Carga Masiva/i })
      .click();

    const fileInput = pageMozartia.locator(
      'input[type="file"][accept*=".xlsx"]'
    );
    await fileInput.waitFor({ state: "visible" });

    await fileInput.setInputFiles({
      name: "autorizaciones.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: bufferTransformado,
    });

    await pageMozartia
      .locator('button:not([disabled]):has-text("Cargar Archivo")')
      .waitFor({ state: "visible", timeout: 15000 });

    await pageMozartia
      .getByRole("button", { name: /Cargar Archivo/i })
      .click();

    await page.waitForTimeout(2000);

    console.log("✅ Excel subido a Mozart");

    /* ======================
       CREAR CITAS PENDIENTES
    ====================== */
    console.log("📅 Creando citas pendientes...");

    const resultadosCitas = [];
    for (const persona of personasSubidas) {
      const resultado = await crearCitaParaPersona(tenant, persona, sesionMozart);
      resultadosCitas.push(resultado);
    }

    const citasFallidas = resultadosCitas.filter((r) => !r.ok);
    const citasExitosas = resultadosCitas.length - citasFallidas.length;

    console.log(`✅ Citas creadas: ${citasExitosas} / ${resultadosCitas.length}`);
    if (citasFallidas.length > 0) {
      console.log("⚠️ No se pudo agendar cita para:", citasFallidas.map(c => c.cedula));
    }

    // ✅ Respuesta final con las personas procesadas
    return res.status(200).json({
      mensaje: "Autorizaciones cargadas exitosamente",
      total: personasSubidas.length,
      personas: personasSubidas,
      citasPendientes: {
        exitosas: citasExitosas,
        totalCitas: resultadosCitas.length,
        noAgendados: citasFallidas.map((c) => ({
          cedula: c.cedula,
          nombre: c.nombre,
          error: c.error,
        })),
      },
    });

  } catch (error) {
    console.error("Error en el proceso:", error);
    if (!res.headersSent) {
      res.status(500).json({
        mensaje: "Error durante el proceso",
        error: error.message,
      });
    }
  } finally {
    console.log("🔒 Cerrando sesión Hyperbrowser...");
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.log("Error cerrando browser:", e.message);
    }
    console.log("✅ Sesión cerrada correctamente");
  }
};



export const AgendarCitaGuajiraCristal = async (req, res) => {
  const {
    documento, fechaCita, horaCita, centroCosto, codigoServicio, tipoAtencion,
    numeroAutorizacion, fechaAutorizacion, fechaVencimiento, copago, valorCopago,
    tipoCopago, valorCita, observaciones, acompanante, responsable, especialidadCristal,
    // Campos Mozart
    doctorId, tipo, tenant, pacienteId, especialidad, autorizacionId, sedeId, citaId
  } = req.body;

  const formatearFecha = (f) => {
    if (!f) return f;

    const separador = f.includes('/') ? '/' : '-';
    const partes = f.split(separador);

    if (partes.length !== 3) {
      throw new Error(`Formato de fecha inválido: ${f}`);
    }

    // Si ya está en formato YYYY-MM-DD
    if (partes[0].length === 4) return f;

    const [dia, mes, anio] = partes;
    return `${anio}-${mes}-${dia}`;
  };

  const [
    fechaCitaFormateada,
    fechaAutorizacionFormateada,
    fechaVencimientoFormateada
  ] = [fechaCita, fechaAutorizacion, fechaVencimiento].map(formatearFecha);

  const usuario = process.env.USUARIOGUAJIRA
  const clave = process.env.CLAVEGUAJIRA
  const profileId = process.env.profileIdGuajira

  let session = null;
  let browser = null;
  let procesando = true;

  try {
    // Intentar con el perfil existente
    session = await client.sessions.create({ 
      acceptCookies: true,
      profile: {
        id: profileId,
        persistChanges: true,
      }
    });

    browser = await chromium.connectOverCDP(session.wsEndpoint);
    let context = browser.contexts()[0];
    let page = context.pages()[0];

    const manejarModalActualizacion = (paginaActual) => {
      (async () => {
        while (procesando) {
          try {
            const btnPostergar = paginaActual.locator('.q-dialog button span.block', {
              hasText: 'Postergar'
            }).first();
            if (await btnPostergar.count() > 0) {
              console.log("🔔 Modal de actualización detectado - Postergando...");
              await btnPostergar.click();
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      })();
    };

    const manejarModalAviso = (paginaActual) => {
      (async () => {
        while (procesando) {
          try {
            const btnEntendido = paginaActual.locator('button.bg-red-8:has(span.block:text("Entendido"))').first();
            if (await btnEntendido.count() > 0) {
              console.log("🔔 Modal de aviso detectado - Cerrando...");
              await btnEntendido.click();
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      })();
    };

    manejarModalActualizacion(page);
    manejarModalAviso(page);

    await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, { waitUntil: "networkidle" });

    const sesionExpirada = await detectarSesionExpiradaCristal(page);

    if (sesionExpirada) {
      console.log("⚠️ Sesión expirada - Renovando perfil...");
      procesando = false;

      await browser.close();
      await client.sessions.stop(session.id);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 🔑 Nueva sesión con el liveUrl correcto
      session = await client.sessions.create({
        acceptCookies: true,
        saveDownloads: true,
        profile: { id: profileId, persistChanges: true }
      });

      browser = await chromium.connectOverCDP(session.wsEndpoint);
      context = browser.contexts()[0];
      page = context.pages()[0];

      procesando = true;
      manejarModalActualizacion(page);

      // Login
      await page.goto(`${QRYSTALOS_BASE_URL}/#/autenticarse`);

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, QRYSTALOS_ORGANIZACION);
      await page.waitForSelector(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);
      await page.click(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);

      const usuarioInput = page.locator('input[aria-label="Usuario *"]').first();
      await usuarioInput.waitFor({ state: 'attached' });
      await usuarioInput.fill(usuario);

      const claveInput = page.locator('input[aria-label="Clave Secreta *"]').first();
      await claveInput.waitFor({ state: 'attached' });
      await claveInput.fill(clave);

      await page.click('button:has-text("Continuar")');
      await page.waitForLoadState("networkidle");

      console.log("✅ Perfil renovado con nueva sesión");
    }

        await page.waitForTimeout(1000);

        // Continuar con el flujo normal
        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(1500);

        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce/agendamiento`, {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");
        
        await page.waitForTimeout(2000);

        // 1️⃣ Click al botón de acción (recargar)
        await page.waitForSelector('.accion-btn', { timeout: 10000 });
        await page.click('.accion-btn');

        // 2️⃣ Escribir documento
        await page.waitForSelector('input[placeholder="Doc. Identificación"]');

        await page.fill('input[placeholder="Doc. Identificación"]', documento);

        // esperar que cargue la búsqueda
        await page.waitForTimeout(1500);

        const sinDatos = page.locator('.q-table__bottom--nodata');
        if (await sinDatos.count() > 0) {
          return res.status(404).json({
            mensaje: "Paciente no encontrado en Cristal",
            documento,
            encontrado: false
          });
        }

        // Esperar tabla con resultados
        await page.waitForSelector('.q-table tbody tr.q-tr.cursor-pointer', { timeout: 10000 });

        const sinDatosTabla = await page.locator('.q-table tbody tr.q-tr.cursor-pointer').count() === 0;
        if (sinDatosTabla) {
          return res.status(404).json({ mensaje: "Paciente no encontrado en Cristal", documento, encontrado: false });
        }

        // Click en la fila del paciente
        const fila = page.locator('.q-table tbody tr.q-tr.cursor-pointer', { hasText: documento }).first();
        await fila.waitFor();
        await fila.click();

        // Esperar a que aparezca el panel o el botón Seleccionar
        const aparecioPanel = await page.locator('.afi-actions-panel__header').waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

        if (aparecioPanel) {
          const botonSeleccionarTarjeta = page.locator('.afi-actions-panel i.fa-solid.fa-arrow-pointer').locator('xpath=../..');
          await botonSeleccionarTarjeta.click();
        } else {
          const botonSeleccionar = page.locator('button', { hasText: 'Seleccionar' }).last();
          await botonSeleccionar.waitFor({ state: 'visible' });
          await botonSeleccionar.click();
        }


        const botonLista = page.locator('.accion-btn').nth(2);
        await botonLista.waitFor();
        await botonLista.click();

        const especialidadInput = page.locator('input[aria-label="Especialidad"]');
        await especialidadInput.click();

        await page.locator('.q-menu').waitFor({ state: 'visible', timeout: 5000 });
        const itemsTexts = await page.locator('.q-menu .q-item').allTextContents();
        const matchIdx = itemsTexts.findIndex(t => normalizar(t).includes(normalizar(especialidadCristal)));
        if (matchIdx === -1) {
          return res.status(404).json({ mensaje: `Especialidad "${especialidadCristal}" no encontrada en Cristal` });
        }
        await page.locator('.q-menu .q-item').nth(matchIdx).click();
        await page.locator('input[aria-label="Fecha Inicial"]').fill(fechaCitaFormateada);


        await page.waitForTimeout(2000);
        await page.locator('input[aria-label="Fecha final"]').fill(fechaCitaFormateada);

        await page.waitForTimeout(1000);
        const sinDatosEspecialidad = page.locator('.q-table__bottom--nodata');
        if (await sinDatosEspecialidad.count() > 0) {
          return res.status(404).json({ mensaje: `Sin disponibilidad para la especialidad "${especialidadCristal}" en Cristal` });
        }

        const citaEncontrada = await seleccionarCita(page, fechaCita, horaCita);

        if (!citaEncontrada) {
          return res.status(404).json({
            mensaje: "La fecha u hora solicitada no está disponible en Qrystal",
            fechaSolicitada: fechaCita,
            horaSolicitada: horaCita,
            disponible: false
          });
        }

        await page.waitForTimeout(2500);

        if (centroCosto) {
          // 1️⃣ Ubicar input del select
          const centroCostoInput = page.locator('input[aria-label="Centro de costo"]');
          await centroCostoInput.click();
          
          // 2️⃣ Escribir palabra clave para filtrar
          const palabraClave = centroCosto.split(' ')[0]; 
          await centroCostoInput.fill(palabraClave);

          // 3️⃣ Esperar que aparezcan opciones
          const listaOpciones = page.locator('.q-menu .q-item');
          await listaOpciones.first().waitFor({ state: 'visible' });

          // 4️⃣ Buscar la opción que contenga el texto deseado
          const opcionSeleccionada = listaOpciones.filter({
            hasText: centroCosto // busca coincidencia parcial con todo tu texto
          }).first();

          await opcionSeleccionada.click();
        }

        const tipoInput = page.locator('input[aria-label="Tipo de Atención"]');
        await tipoInput.waitFor();
        await tipoInput.click();
        await tipoInput.fill(tipoAtencion);

        const opcionTipo = page.locator('.q-menu .q-item', {
          hasText: tipoAtencion
        }).first();

        await opcionTipo.waitFor();
        await opcionTipo.click();

        // ===== Clase Orden =====
        const claseOrden = page.locator('input[aria-label="Clase Orden:-"]');

        await claseOrden.click();
        await claseOrden.fill('Normal');

        const opcionClase = page.locator('.q-menu .q-item', {
          hasText: 'Normal'
        }).first();

        await opcionClase.click();

        if (codigoServicio) {

          const serviciosInput = page.locator('input[aria-label="Servicios"]');
          await serviciosInput.click();
          await serviciosInput.fill(codigoServicio);

          // esperar que aparezca el menú con opciones
          const primeraOpcion = page.locator('.q-menu .q-item').first();
          await primeraOpcion.waitFor({ state: 'visible' });

          // seleccionar la opción filtrada
          await primeraOpcion.click();
        }

        // ===== Número de autorización =====
        if (numeroAutorizacion) {

          const autorizacion = page.locator('input[aria-label="N° Autorizacion"]');
          await autorizacion.fill(numeroAutorizacion);

          // esperar a que aparezcan los campos
          const fechaAutorizacion = page.locator('input[aria-label="Fecha Autorizacion:"]');
          await fechaAutorizacion.waitFor({ state: 'visible' });

          const fechaVencimiento = page.locator('input[aria-label="Fecha Vencimiento:"]');

          await fechaAutorizacion.fill(fechaAutorizacionFormateada);
          await fechaVencimiento.fill(fechaVencimientoFormateada);
        }

        // ===== COPAGO =====
        if (copago === true || copago === "true") {

          const checkCopago = page.locator('[aria-label="Copago Propio?"]');
          await checkCopago.click();

          const valorCopagoInput = page.locator('input[aria-label="Valor Copago"]');
          await valorCopagoInput.waitFor({ state: 'visible' });

          const tipoCopagoSelect = page.locator('[aria-label="Tipo copago"]');
          const valorCitaInput = page.locator('input[aria-label="Valor Cita"]');

          await valorCopagoInput.fill(String(valorCopago));
          await valorCitaInput.fill(String(valorCita));

          // abrir selector
          await tipoCopagoSelect.click();

          // seleccionar por texto visible
          const opcionTipoCopago = page.locator('.q-menu .q-item', {
            hasText: tipoCopago
          }).first();

          await opcionTipoCopago.waitFor();
          await opcionTipoCopago.click();

        } else {

          const noCobrar = page.locator('[aria-label="No Cobrar"]');
          await noCobrar.click();

        }

        if (observaciones) {
          const observacionesInput = page.locator('textarea[aria-label="Observaciones:"]');
          await observacionesInput.waitFor({ state: 'visible' });
          await observacionesInput.fill(observaciones);
        }

        if (acompanante || responsable) {
          // abrir pestaña
          const tabAcompanante = page.locator('.q-tab', {
            hasText: 'Acompañante/Responsable'
          });

          await tabAcompanante.click();

          // ===== DATOS ACOMPAÑANTE =====
          if (acompanante) {

            const nombreAcomp = page.locator('input[aria-label="Nombre Acompañante:"]').first();
            const direccionAcomp = page.locator('input[aria-label="Direccion:"]');
            const telefonoAcomp = page.locator('input[aria-label="Teléfono:"]').first();

            await nombreAcomp.fill(acompanante.nombre);
            await direccionAcomp.fill(acompanante.direccion);
            await telefonoAcomp.fill(acompanante.telefono);

            // parentesco (select)
            const parentescoSelect = page.locator('[aria-label="Parentesco"]').first();
            await parentescoSelect.click();

            const opcionParentesco = page.locator('.q-menu .q-item', {
              hasText: acompanante.parentesco
            }).first();

            await opcionParentesco.waitFor({ state: 'visible' });
            await opcionParentesco.click();
          }

          // ===== DATOS RESPONSABLE =====
          if (responsable) {

            const nombreResp = page.locator('input[aria-label="Nombre Acompañante:"]').nth(1);
            const telefonoResp = page.locator('input[aria-label="Teléfono:"]').nth(1);
            const parentescoResp = page.locator('input[aria-label="Parentesco:"]');

            await nombreResp.fill(responsable.nombre);
            await telefonoResp.fill(responsable.telefono);
            await parentescoResp.fill(responsable.parentesco);
          }
        }

        const botonAgendar = page.locator('button', {
          hasText: 'Agendar'
        });

        await botonAgendar.waitFor({ state: 'visible' });
        await botonAgendar.click();
        await page.waitForTimeout(1000);

        const resultado = await Promise.race([
          page.waitForSelector('.q-notification .q-notification__message', { timeout: 8000 })
            .then(el => ({ tipo: 'exito', elemento: el })),
          page.waitForSelector('.q-card.my-card .q-bar--dark.bg-red-8', { timeout: 8000 })
            .then(el => ({ tipo: 'error', elemento: el })),
        ]);

        if (resultado.tipo === 'error') {
          // Extraer el mensaje de error del modal
          const elementosError = page.locator('.q-card.my-card .q-item__label');
          const totalErrores = await elementosError.count();

          const errores = [];
          for (let i = 0; i < totalErrores; i++) {
            const texto = await elementosError.nth(i).textContent();
            if (texto?.trim()) errores.push(texto.trim());
          }

          // Cerrar el modal (botón "Entendido")
          const btnEntendido = page.locator('.q-card.my-card button span.block', {
            hasText: 'Entendido'
          }).first();
          if (await btnEntendido.count() > 0) {
            await btnEntendido.click();
          }

          return res.status(409).json({
            mensaje: "Error al agendar en Cristal",
            errores,
            totalErrores: errores.length,
            cristal: "fallido",
            mozart: "No se agendo en mozart"
          });
        }

        // Verificar que el toast diga lo esperado
        const textoToast = await resultado.elemento.textContent();
        if (!textoToast?.includes('Agendada Exitosamente')) {
          return res.status(500).json({
            mensaje: "Respuesta inesperada de Cristal tras agendar",
            textoRecibido: textoToast?.trim(),
            cristal: "incierto",
          });
        }

        console.log("✅ Cita agendada en Cristal exitosamente");
        

        // ─────────────────────────────────────────────
        // 🎵 PASO 2: Agendar en Mozart
        // Solo se ejecuta si Cristal fue exitoso
        // ─────────────────────────────────────────────
        console.log("🎵 Agendando en Mozart...");

        const mozartResponse = await fetch(`${MOZART_BASE_URL}/api/external/appointment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.MOZART_API_KEY
          },
          body: JSON.stringify({
            hora: horaCita,
            doctorId,
            tipo,
            tenant,
            pacienteId,
            fecha: fechaCitaFormateada,
            especialidad,
            autorizacionId,
            sedeId,
            citaId,
          })
        });

        if (!mozartResponse.ok) {
          const errorMozart = await mozartResponse.text();
          console.error("❌ Mozart falló:", errorMozart);

          // Cristal quedó agendada, Mozart no — retornar advertencia con detalle
          return res.status(207).json({
            mensaje: "Cita agendada en Cristal pero falló en Mozart",
            cristal: "agendado",
            mozart: "fallido",
            mozartStatus: mozartResponse.status,
            mozartError: errorMozart
          });
        }

        const mozartData = await mozartResponse.json();
        console.log("✅ Cita agendada en Mozart exitosamente");


        procesando = false;

        console.log("Cita agendada exitosamente en Cristal y Mozart")

        return res.status(200).json({
          mensaje: "Cita agendada exitosamente en Cristal y Mozart",
          cristal: "agendado",
          mozart: "agendado",
          mozartData
        });
      
  } catch (error) {
    console.error("❌ Error:", error.message);
        if (!res.headersSent) {
          res.status(500).json({
            mensaje: "Error al agendar la cita",
            error: error.message,
          });
        }
  }finally {
    procesando = false;
    try {
      if (browser) await browser.close();
      if (session) await client.sessions.stop(session.id);
      console.log("✅ Sesión cerrada correctamente");
    } catch (e) {
      console.error("⚠️ Error al cerrar sesión:", e.message);
    }
  }
}


export const ReAgendarCitaGuajiraCristal = async (req, res) => {
  const { fechaAntigua, horaAntigua, nuevaFecha, nuevaHora, observacion, especialidad, pacienteId, tenant, tipo, doctorId, citaIdOriginal, especialidadCristal } = req.body

  const formatearFecha = (f) => {
    if (!f) return f;

    // Detecta separador automáticamente
    const separador = f.includes('/') ? '/' : '-';

    const partes = f.split(separador);

    // Si ya viene en formato YYYY-MM-DD no tocar
    if (partes[0].length === 4) return f;

    const [dia, mes, anio] = partes;
    return `${anio}-${mes}-${dia}`;
  };

  const [fechaAntiguaInput, nuevaFechaFormateada] =
    [fechaAntigua, nuevaFecha].map(formatearFecha);

  const usuario = process.env.USUARIOGUAJIRA
  const clave = process.env.CLAVEGUAJIRA
  const profileId = process.env.profileIdGuajira

  let session = null;
  let browser = null;
  let procesando = true;

  try {
    // Intentar con el perfil existente
    session = await client.sessions.create({ 
      acceptCookies: true,
      profile: {
        id: profileId,
        persistChanges: true,
      }
    });

    browser = await chromium.connectOverCDP(session.wsEndpoint);
    let context = browser.contexts()[0];
    let page = context.pages()[0];

    const manejarModalActualizacion = (paginaActual) => {
      (async () => {
        while (procesando) {
          try {
            const btnPostergar = paginaActual.locator('.q-dialog button span.block', {
              hasText: 'Postergar'
            }).first();
            if (await btnPostergar.count() > 0) {
              console.log("🔔 Modal de actualización detectado - Postergando...");
              await btnPostergar.click();
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      })();
    };

    manejarModalActualizacion(page);

    await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, { waitUntil: "networkidle" });

    const sesionExpirada = await detectarSesionExpiradaCristal(page);

    if (sesionExpirada) {
      console.log("⚠️ Sesión expirada - Renovando perfil...");
      procesando = false;

      await browser.close();
      await client.sessions.stop(session.id);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 🔑 Nueva sesión con el liveUrl correcto
      session = await client.sessions.create({
        acceptCookies: true,
        saveDownloads: true,
        profile: { id: profileId, persistChanges: true }
      });

      browser = await chromium.connectOverCDP(session.wsEndpoint);
      context = browser.contexts()[0];
      page = context.pages()[0];

      procesando = true;
      manejarModalActualizacion(page);

      // Login
      await page.goto(`${QRYSTALOS_BASE_URL}/#/autenticarse`);

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, QRYSTALOS_ORGANIZACION);
      await page.waitForSelector(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);
      await page.click(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);

      const usuarioInput = page.locator('input[aria-label="Usuario *"]').first();
      await usuarioInput.waitFor({ state: 'attached' });
      await usuarioInput.fill(usuario);

      const claveInput = page.locator('input[aria-label="Clave Secreta *"]').first();
      await claveInput.waitFor({ state: 'attached' });
      await claveInput.fill(clave);

      await page.click('button:has-text("Continuar")');
      await page.waitForLoadState("networkidle");

      console.log("✅ Perfil renovado con nueva sesión");
    }

        // Continuar con el flujo normal
        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(3000);

        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce/agendamiento`, {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");

        await page.waitForTimeout(1500);

        const fechaInput = page.locator('input[aria-label="Fecha"]');
        await fechaInput.fill(fechaAntiguaInput);

        const especialidadInput = page.locator('input[aria-label="Seleccione una especialidad"]');
        await especialidadInput.click();

        await page.locator('.q-menu').waitFor({ state: 'visible', timeout: 5000 });
        const itemsTexts = await page.locator('.q-menu .q-item').allTextContents();
        const matchIdx = itemsTexts.findIndex(t => normalizar(t).includes(normalizar(especialidadCristal)));
        if (matchIdx === -1) {
          return res.status(404).json({ mensaje: `Especialidad "${especialidadCristal}" no encontrada en Cristal` });
        }
        await page.locator('.q-menu .q-item').nth(matchIdx).click();
        await page.waitForTimeout(1500);

        await page.waitForTimeout(1000);
        const sinDatos = page.locator('.q-table__bottom--nodata');
        if (await sinDatos.count() > 0) {
          return res.status(404).json({ mensaje: `Sin disponibilidad para la especialidad "${especialidadCristal}" en Cristal` });
        }
        await page.getByRole('button', { name: 'Ocupado' }).click();

        const fila = page.locator('tr.q-tr', {
          has: page.locator('td span', { hasText: horaAntigua })
        });
        await fila.locator('td.cursor-pointer').click();
        await page.waitForTimeout(1000);
        await page.locator('button:has(i.material-icons:text("event_repeat"))').click();
        await page.waitForTimeout(1000);

        await seleccionarCita(page, nuevaFecha, nuevaHora);

        const selectMotivo = page.locator('label:has-text("Motivo Re-programación:") input[role="combobox"]');
        await selectMotivo.waitFor();

        // Hacer click para abrir el dropdown
        await selectMotivo.click();

        // Escribir la opción que queremos seleccionar
        await selectMotivo.fill('Reprogramado por paciente');

        // Esperar que aparezca la opción en la lista y hacer click
        const opcionReprog = page.locator('.q-menu .q-item', {
          hasText: 'Reprogramado por paciente'
        }).first();
        await opcionReprog.waitFor();
        await opcionReprog.click();

        const inputObservacion = page.locator('input[aria-label="Observación"]');
        await inputObservacion.waitFor();
        await inputObservacion.fill(observacion);

        const botonReagendar = page.locator('button:has-text("Re-programar Cita")');
        await botonReagendar.waitFor();
        await botonReagendar.click();
        await page.waitForTimeout(2500);

        console.log("✅ Cita reprogramada correctamente");

        //MOZART REAGENDAMIENTO

        const mozartResponse = await fetch(`${MOZART_BASE_URL}/api/external/reschedule-appointment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.MOZART_API_KEY
          },
          body: JSON.stringify({
            hora: nuevaHora,
            doctorId,
            tipo,
            tenant,
            pacienteId,
            fecha: nuevaFechaFormateada,
            especialidad,
            citaIdOriginal,
            motivo: observacion,
            especialidad
          })
        });

        if (!mozartResponse.ok) {
          const errorMozart = await mozartResponse.text();
          console.error("❌ Mozart falló:", errorMozart);

          // Cristal quedó agendada, Mozart no — retornar advertencia con detalle
          return res.status(207).json({
            mensaje: "Cita reagendada en Cristal pero falló en Mozart",
            cristal: "reagendado",
            mozart: "fallido",
            mozartStatus: mozartResponse.status,
            mozartError: errorMozart
          });
        }

        const mozartData = await mozartResponse.json();
        console.log("✅ Cita reagendada en Mozart exitosamente");

        procesando = false;

        console.log("Cita reagendada exitosamente en Cristal y Mozart")

        return res.status(200).json({
          mensaje: "Cita reagendada exitosamente en Cristal y Mozart",
          cristal: "reagendado",
          mozart: "reagendado",
          mozartData
        });

      } catch (error) {
        console.error("❌ Error:", error.message);
        if (!res.headersSent) {
          res.status(500).json({
            mensaje: "Error al reagendar la cita",
            error: error.message,
          });
        }
  }finally {
    procesando = false;
    try {
      if (browser) await browser.close();
      if (session) await client.sessions.stop(session.id);
      console.log("✅ Sesión cerrada correctamente");
    } catch (e) {
      console.error("⚠️ Error al cerrar sesión:", e.message);
    }
  }
}

export const CancelarCitaGuajiraCristal = async (req, res) => {
  const { fecha, hora, observacion, citaId, tenant, especialidadCristal } = req.body

  const fechaCancelar = (() => {
    if (!fecha) return fecha;

    const separador = fecha.includes('/') ? '/' : '-';
    const partes = fecha.split(separador);

    if (partes.length !== 3) {
      throw new Error(`Formato de fecha inválido: ${fecha}`);
    }

    // Si ya está en formato YYYY-MM-DD
    if (partes[0].length === 4) return fecha;

    const [dia, mes, anio] = partes;
    return `${anio}-${mes}-${dia}`;
  })();

  const usuario = process.env.USUARIOGUAJIRA
  const clave = process.env.CLAVEGUAJIRA
  const profileId = process.env.profileIdGuajira

  let session = null;
  let browser = null;
  let procesando = true;

  try {
    // Intentar con el perfil existente
    session = await client.sessions.create({ 
      acceptCookies: true,
      profile: {
        id: profileId,
        persistChanges: true,
      }
    });

    browser = await chromium.connectOverCDP(session.wsEndpoint);
    let context = browser.contexts()[0];
    let page = context.pages()[0];

    const manejarModalActualizacion = (paginaActual) => {
      (async () => {
        while (procesando) {
          try {
            const btnPostergar = paginaActual.locator('.q-dialog button span.block', {
              hasText: 'Postergar'
            }).first();
            if (await btnPostergar.count() > 0) {
              console.log("🔔 Modal de actualización detectado - Postergando...");
              await btnPostergar.click();
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      })();
    };

    manejarModalActualizacion(page);

    await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, { waitUntil: "networkidle" });

    const sesionExpirada = await detectarSesionExpiradaCristal(page);

    if (sesionExpirada) {
      console.log("⚠️ Sesión expirada - Renovando perfil...");
      procesando = false;

      await browser.close();
      await client.sessions.stop(session.id);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 🔑 Nueva sesión con el liveUrl correcto
      session = await client.sessions.create({
        acceptCookies: true,
        saveDownloads: true,
        profile: { id: profileId, persistChanges: true }
      });

      browser = await chromium.connectOverCDP(session.wsEndpoint);
      context = browser.contexts()[0];
      page = context.pages()[0];

      procesando = true;
      manejarModalActualizacion(page);

      // Login
      await page.goto(`${QRYSTALOS_BASE_URL}/#/autenticarse`);

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, QRYSTALOS_ORGANIZACION);
      await page.waitForSelector(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);
      await page.click(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);

      const usuarioInput = page.locator('input[aria-label="Usuario *"]').first();
      await usuarioInput.waitFor({ state: 'attached' });
      await usuarioInput.fill(usuario);

      const claveInput = page.locator('input[aria-label="Clave Secreta *"]').first();
      await claveInput.waitFor({ state: 'attached' });
      await claveInput.fill(clave);

      await page.click('button:has-text("Continuar")');
      await page.waitForLoadState("networkidle");

      console.log("✅ Perfil renovado con nueva sesión");
    }

        // Continuar con el flujo normal
        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(3000);

        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce/agendamiento`, {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");

        const fechaInput = page.locator('input[aria-label="Fecha"]');
        await fechaInput.fill(fechaCancelar);

        const especialidad = page.locator('input[aria-label="Seleccione una especialidad"]');
        await especialidad.click();

        await page.locator('.q-menu').waitFor({ state: 'visible', timeout: 5000 });
        const itemsTexts = await page.locator('.q-menu .q-item').allTextContents();
        const matchIdx = itemsTexts.findIndex(t => normalizar(t).includes(normalizar(especialidadCristal)));
        if (matchIdx === -1) {
          return res.status(404).json({ mensaje: `Especialidad "${especialidadCristal}" no encontrada en Cristal` });
        }
        await page.locator('.q-menu .q-item').nth(matchIdx).click();
        await page.waitForTimeout(1500);

        await page.waitForTimeout(1000);
        const sinDatos = page.locator('.q-table__bottom--nodata');
        if (await sinDatos.count() > 0) {
          return res.status(404).json({ mensaje: `Sin disponibilidad para la especialidad "${especialidadCristal}" en Cristal` });
        }
        await page.getByRole('button', { name: 'Ocupado' }).click();

        const fila = page.locator('tr.q-tr', {
          has: page.locator('td span', { hasText: hora })
        });
        await fila.locator('td.cursor-pointer').click();
        await page.waitForTimeout(1000);
        await page.locator('button:has(i.material-icons:text("block"))').click();
        await page.waitForTimeout(1000);

        const selectCausa = page.locator('label:has-text("Causas (*)") input[role="combobox"]');
        await selectCausa.waitFor();

        // Hacer click para abrir el dropdown
        await selectCausa.click();

        // Escribir la opción que queremos seleccionar
        await selectCausa.fill('CANCELADA POR PACIENTE');

        // Esperar que aparezca la opción en la lista y hacer click
        const opcionCanc = page.locator('.q-menu .q-item', {
          hasText: 'CANCELADA POR PACIENTE'
        }).first();
        await opcionCanc.waitFor();
        await opcionCanc.click();

        await page.getByRole('textbox', { name: 'Observación' }).fill(observacion);

        const botonReagendar = page.locator('button:has-text("Cancelar Cita")');
        await botonReagendar.waitFor();
        await botonReagendar.click();
        await page.waitForTimeout(2500);

        console.log("✅ Cita Cancelada correctamente");

        //MOZART REAGENDAMIENTO

        const mozartResponse = await fetch(`${MOZART_BASE_URL}/api/external/cancel-appointment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.MOZART_API_KEY
          },
          body: JSON.stringify({
            hora,
            citaId,
            notas: observacion,
            tenant
          })
        });

        if (!mozartResponse.ok) {
          const errorMozart = await mozartResponse.text();
          console.error("❌ Mozart falló:", errorMozart);

          // Cristal quedó agendada, Mozart no — retornar advertencia con detalle
          return res.status(207).json({
            mensaje: "Cita cancelada en Cristal pero falló en Mozart",
            cristal: "cancelado",
            mozart: "fallido",
            mozartStatus: mozartResponse.status,
            mozartError: errorMozart
          });
        }

        const mozartData = await mozartResponse.json();
        console.log("✅ Cita cancelada en Mozart exitosamente");

        procesando = false;

        console.log("Cita cancelada exitosamente en Cristal y Mozart")

        return res.status(200).json({
          mensaje: "Cita cancelada exitosamente en Cristal y Mozart",
          cristal: "cancelado",
          mozart: "cancelado",
          mozartData
        });


      } catch (error) {
        console.error("❌ Error:", error.message);
        if (!res.headersSent) {
          res.status(500).json({
            mensaje: "Error al agendar la cita",
            error: error.message,
          });
        }
  }finally {
    procesando = false;
    try {
      if (browser) await browser.close();
      if (session) await client.sessions.stop(session.id);
      console.log("✅ Sesión cerrada correctamente");
    } catch (e) {
      console.error("⚠️ Error al cerrar sesión:", e.message);
    }
  }

}


export const disponibilidadQrystalMozart = async (req, res) => {
  
  const { especialidadCristal } = req.body;
  const usuario = process.env.USUARIOGUAJIRA
  const clave = process.env.CLAVEGUAJIRA
  const profileId = process.env.profileIdGuajira

  let session = null;
  let browser = null;
  let procesando = true;

  try {
    // Intentar con el perfil existente
    session = await client.sessions.create({ 
      acceptCookies: true,
      profile: {
        id: profileId,
        persistChanges: true,
      }
    });

    browser = await chromium.connectOverCDP(session.wsEndpoint);
    let context = browser.contexts()[0];
    let page = context.pages()[0];

    const manejarModalActualizacion = (paginaActual) => {
      (async () => {
        while (procesando) {
          try {
            const btnPostergar = paginaActual.locator('.q-dialog button span.block', {
              hasText: 'Postergar'
            }).first();
            if (await btnPostergar.count() > 0) {
              console.log("🔔 Modal de actualización detectado - Postergando...");
              await btnPostergar.click();
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      })();
    };

    manejarModalActualizacion(page);

    await page.goto(`${QRYSTALOS_BASE_URL}/#/autenticarse`);

    const selectorInput = 'input[aria-label="Organización *"]';
    await page.click(selectorInput);
    await page.fill(selectorInput, QRYSTALOS_ORGANIZACION);
    await page.click(`div.q-item span:has-text("${QRYSTALOS_ORGANIZACION}")`);

    await page.locator('input[aria-label="Usuario *"]').fill(usuario);
    await page.locator('input[aria-label="Clave Secreta *"]').fill(clave);

    await page.click('button:has-text("Continuar")');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, { waitUntil: "networkidle" });

        // Continuar con el flujo normal
        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce`, {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(2000);

        await page.goto(`${QRYSTALOS_BASE_URL}/#/ce/agendamiento`, {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");

        const botonLista = page.locator('.accion-btn').nth(2);

        await botonLista.waitFor();
        await botonLista.click();

        // abrir select especialidad
        const especialidadInput = page.locator('input[aria-label="Especialidad"]');

        await especialidadInput.click();

        await page.locator('.q-menu').waitFor({ state: 'visible', timeout: 5000 });
        const itemsTexts = await page.locator('.q-menu .q-item').allTextContents();
        const matchIdx = itemsTexts.findIndex(t => normalizar(t).includes(normalizar(especialidadCristal)));
        if (matchIdx === -1) {
          return res.status(404).json({ mensaje: `Especialidad "${especialidadCristal}" no encontrada en Cristal` });
        }
        await page.locator('.q-menu .q-item').nth(matchIdx).click();


        await page.waitForTimeout(1000);
        const sinDatos = page.locator('.q-table__bottom--nodata');
        if (await sinDatos.count() > 0) {
          return res.status(404).json({ mensaje: `Sin disponibilidad para la especialidad "${especialidadCristal}" en Cristal` });
        }
        const fechaInicial = await page.locator('input[aria-label="Fecha Inicial"]').inputValue();
        const fechaFinal = moment(fechaInicial).add(1, 'month').format('YYYY-MM-DD');

        const inputFechaFinal = page.locator('input[aria-label="Fecha final"]');
        await inputFechaFinal.fill(fechaFinal);

        await page.waitForTimeout(1000);


        // Extraer datos de todas las páginas
        const extraerDatosTabla = async (page) => {
          return await page.evaluate(() => {
            const filas = document.querySelectorAll('.q-table tbody tr');
            const datos = [];
            filas.forEach(fila => {
              const celdas = fila.querySelectorAll('td span.cursor-pointer');
              if (celdas.length > 0) {
                datos.push({
                  dia: celdas[1]?.innerText?.trim(),
                  fecha: celdas[2]?.innerText?.trim(),
                });
              }
            });
            return datos;
          });
        };

        const todasLasCitas = [];

        while (true) {
          await page.waitForTimeout(500);
          const datos = await extraerDatosTabla(page);
          todasLasCitas.push(...datos);

          const btnSiguiente = page.locator('button[aria-label="Próxima página"]');
          const estaDeshabilitado = await btnSiguiente.getAttribute('disabled');

          if (estaDeshabilitado !== null) {
            console.log("✅ Se llegó a la última página");
            break;
          }

          await btnSiguiente.click();
        }

        // Si hay menos de 10 citas, ampliar a 2 meses
        if (todasLasCitas.length < 5) {
          console.log(`⚠️ Poca disponibilidad (${todasLasCitas.length} citas), ampliando a 2 meses...`);
          todasLasCitas.length = 0; // limpiar

          fechaFinal = moment(fechaInicial).add(2, 'months').format('YYYY-MM-DD');
          await inputFechaFinal.fill(fechaFinal);
          await page.waitForTimeout(500);

          while (true) {
            await page.waitForTimeout(500);
            const datos = await extraerDatosTabla(page);
            todasLasCitas.push(...datos);

            const btnSiguiente = page.locator('button[aria-label="Próxima página"]');
            const estaDeshabilitado = await btnSiguiente.getAttribute('disabled');

            if (estaDeshabilitado !== null) {
              console.log("✅ Se llegó a la última página (2 meses)");
              break;
            }

            await btnSiguiente.click();
          }
        }

        console.log("📅 Total citas encontradas:", todasLasCitas.length);

        res.status(200).json({
          mensaje: "Disponibilidad consultada correctamente",
          total: todasLasCitas.length,
          disponibilidad: todasLasCitas,
        });

        } catch (error) {
        console.error("❌ Error:", error.message);
        if (!res.headersSent) {
          res.status(500).json({
            mensaje: "Error al consultar el estado de la cita",
            error: error.message,
          });
        }
      }finally {
        
        procesando = false;

        if (browser) {
          await browser.close().catch(e => console.warn("⚠️ Error cerrando browser:", e.message));
        }
        if (session) {
          await client.sessions.stop(session.id).catch(e => console.warn("⚠️ Error cerrando sesión:", e.message));
        }

        console.log("🔒 Sesión y browser cerrados correctamente");
      }
}