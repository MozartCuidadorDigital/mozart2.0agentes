import dotenv from "dotenv";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import axios from "axios";
import { transformarAutorizacionesGuajira, transformarAutorizacionesEsperanza } from "../../../utils/excel/transformarAutorizaciones.js";
import { generarExcelBuffer } from "../../../utils/excel/escribirExcel.js";
import moment from "moment-timezone";
import { leerExcelDesdeBuffer } from "../../../utils/excel/leerExcel.js";

dotenv.config();

let browser, page, session; 
let contextGlobal;
let pageMozartia;

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});


/* ======================
   HELPERS: PATIENT-INFO + APPOINTMENT
====================== */

const obtenerPacienteId = async (tenant, identificacion) => {
  const { data } = await axios.post(
    "https://api.salud.mozartai.com.co/api/external/patient-info",
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

const crearCitaPendiente = async ({ tenant, pacienteId, servicio }) => {
  const { data } = await axios.post(
    "https://api.salud.mozartai.com.co/api/external/appointment",
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
        "x-api-key": process.env.MOZART_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  return data;
};

const crearCitaParaPersona = async (tenant, persona) => {
  try {
    const pacienteId = await obtenerPacienteId(tenant, persona.cedula);
    const cita = await crearCitaPendiente({
      tenant,
      pacienteId,
      servicio: persona.servicio,
    });

    return { cedula: persona.cedula, nombre: persona.nombre, ok: true, cita };
  } catch (error) {
    const mensajeError = error.response?.data?.message || error.message;
    console.error(`❌ Error creando cita para ${persona.cedula}:`, mensajeError);
    return { cedula: persona.cedula, nombre: persona.nombre, ok: false, error: mensajeError };
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
      const resultado = await crearCitaParaPersona(tenant, persona);
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
    tipoCopago, valorCita, observaciones, acompanante, responsable,
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

    manejarModalActualizacion(page);

    await page.goto("https://api-test.qrystalos.com/#/ce", { waitUntil: "networkidle" });

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
      await page.goto("https://api-test.qrystalos.com/#/autenticarse");

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, 'Pruebas Clinica esperanza');
      await page.waitForSelector('div.q-item span:has-text("Pruebas Clinica esperanza")');
      await page.click('div.q-item span:has-text("Pruebas Clinica esperanza")');

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
        await page.goto("https://api-test.qrystalos.com/#/ce", {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(1500);

        await page.goto("https://api-test.qrystalos.com/#/ce/agendamiento", {
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

        // 3️⃣ Esperar la tabla con resultados
        await page.waitForSelector('.q-table tbody tr.q-tr.cursor-pointer');

        // 4️⃣ Buscar la fila que tenga el documento
        const fila = page.locator('.q-table tbody tr.q-tr.cursor-pointer', {
          hasText: documento
        }).first();

        await fila.waitFor();
        await fila.click();

        // esperar que aparezca el panel expandido
        const botonSeleccionar = page.locator('button', {
          hasText: 'Seleccionar'
        }).last(); // usamos el último porque el primero es otro

        await botonSeleccionar.waitFor({ state: "visible" });

        await botonSeleccionar.click();

        const botonLista = page.locator('.accion-btn').nth(2);

        await botonLista.waitFor();
        await botonLista.click();

        // abrir select especialidad
        const especialidadInput = page.locator('input[aria-label="Especialidad"]');

        await especialidadInput.click();

        // escribir para filtrar
        await especialidadInput.fill('PERINATOLOGÍA');

        // esperar opción
        const opcion = page.locator('.q-menu .q-item', {
          hasText: 'PERINATOLOGÍA O MEDICINA FETAL'
        }).first();

        await opcion.waitFor();
        await opcion.click();
        await page.waitForTimeout(2000);
        await page.locator('input[aria-label="Fecha Inicial"]').fill(fechaCitaFormateada);
        await page.waitForTimeout(2000);
        await page.locator('input[aria-label="Fecha final"]').fill(fechaCitaFormateada);

        const valor = await page.locator('input[aria-label="Fecha Inicial"]').inputValue();
        console.log(valor);

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

        const mozartResponse = await fetch("https://new.api.mozartia.com/api/external/appointment", {
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
  const { fechaAntigua, horaAntigua, nuevaFecha, nuevaHora, observacion, especialidad, pacienteId, tenant, tipo, doctorId, citaIdOriginal } = req.body

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

    await page.goto("https://api-test.qrystalos.com/#/ce", { waitUntil: "networkidle" });

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
      await page.goto("https://api-test.qrystalos.com/#/autenticarse");

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, 'Pruebas Clinica esperanza');
      await page.waitForSelector('div.q-item span:has-text("Pruebas Clinica esperanza")');
      await page.click('div.q-item span:has-text("Pruebas Clinica esperanza")');

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
        await page.goto("https://api-test.qrystalos.com/#/ce", {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(3000);

        await page.goto("https://api-test.qrystalos.com/#/ce/agendamiento", {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");

        await page.waitForTimeout(1500);

        const fechaInput = page.locator('input[aria-label="Fecha"]');
        await fechaInput.fill(fechaAntiguaInput);

        const especialidadInput = page.locator('input[aria-label="Seleccione una especialidad"]');
        await especialidadInput.click();
        await especialidadInput.fill('PERINATOLOGÍA');

        // esperar opción
        const opcion = page.locator('.q-menu .q-item', {
          hasText: 'PERINATOLOGÍA O MEDICINA FETAL'
        }).first();

        await opcion.waitFor();
        await opcion.click();

        await page.waitForTimeout(1500);
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

        const mozartResponse = await fetch("https://new.api.mozartia.com/api/external/reschedule-appointment", {
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
  const { fecha, hora, observacion, citaId, tenant } = req.body

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

    await page.goto("https://api-test.qrystalos.com/#/ce", { waitUntil: "networkidle" });

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
      await page.goto("https://api-test.qrystalos.com/#/autenticarse");

      const selectorInput = 'input[aria-label="Organización *"]';
      await page.click(selectorInput);
      await page.fill(selectorInput, 'Pruebas Clinica esperanza');
      await page.waitForSelector('div.q-item span:has-text("Pruebas Clinica esperanza")');
      await page.click('div.q-item span:has-text("Pruebas Clinica esperanza")');

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
        await page.goto("https://api-test.qrystalos.com/#/ce", {
          waitUntil: "networkidle"
        });

        await page.waitForTimeout(3000);

        await page.goto("https://api-test.qrystalos.com/#/ce/agendamiento", {
          waitUntil: "networkidle"
        });

        console.log("✅ Entró a Agenda correctamente");

        const fechaInput = page.locator('input[aria-label="Fecha"]');
        await fechaInput.fill(fechaCancelar);

        const especialidad = page.locator('input[aria-label="Seleccione una especialidad"]');
        await especialidad.click();
        await especialidad.fill('PERINATOLOGÍA');

        // esperar opción
        const opcion = page.locator('.q-menu .q-item', {
          hasText: 'PERINATOLOGÍA O MEDICINA FETAL'
        }).first();

        await opcion.waitFor();
        await opcion.click();

        await page.waitForTimeout(1500);
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

        const mozartResponse = await fetch("https://new.api.mozartia.com/api/external/cancel-appointment", {
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