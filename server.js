
/**
 * ANOR CHECK — SERVER CORE V20.0
 * Architecture : 1 sceau maître par lot + numéros de série unitaires
 * Runtime : Node.js / Express / CommonJS
 * Base de données : Supabase
 *
 * IMPORTANT :
 * - Les 51 glyphes sont communs à toutes les unités d'un même lot.
 * - Seul le numéro de série varie d'une unité à l'autre.
 * - L'OCR extrait le lot et le numéro de série, mais ne prouve pas l'authenticité.
 * - Une vérification positive exige une correspondance visuelle stricte.
 * - Une anomalie de scan est un signal à examiner, pas une preuve de contrefaçon.
 */

"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const supabase = require("./config/database");
const SealRenderer = require("./engine/sealRenderer");

const app = express();

const SERVER_VERSION = "20.0.0";
const VISUAL_BITS_LENGTH = 51;
const VISUAL_VERSION = Number(process.env.VISUAL_VERSION || 2);
const MAX_HAMMING_DISTANCE = 0;
const MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_QUANTITY = 100000;
const PORT = Number(process.env.PORT || 10000);
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.disable("x-powered-by");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

let tesseract = null;
try {
  tesseract = require("tesseract.js");
} catch (_) {
  console.warn("[ANOR] tesseract.js absent : OCR local désactivé.");
}

/* -------------------- HTTP / SÉCURITÉ -------------------- */

const defaultOrigins = [
  "https://anorcheck.onrender.com",
  "http://localhost",
  "https://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:5000",
  "capacitor://localhost"
];

const configuredOrigins = String(
  process.env.FRONTEND_URLS || process.env.FRONTEND_URL || ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

function isPrivateNetworkOrigin(origin) {
  return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin)) {
      return callback(null, true);
    }
    if (!isProduction && isPrivateNetworkOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-API-Version",
    "X-Request-Id",
    "X-Anor-Signature"
  ]
}));

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use((req, res, next) => {
  const started = Date.now();
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  res.on("finish", () => {
    const log = {
      time: new Date().toISOString(),
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - started
    };
    (res.statusCode >= 400 ? console.warn : console.log)(
      "[ANOR]", JSON.stringify(log)
    );
  });
  next();
});

/* -------------------- RÉPONSES / UTILITAIRES -------------------- */

function apiSuccess(res, data = {}, status = 200) {
  return res.status(status).json({
    success: true,
    requestId: res.getHeader("X-Request-Id") || null,
    timestamp: Date.now(),
    ...data
  });
}

function apiError(res, status, code, message, details = null) {
  const error = { code, message };
  if (details && !isProduction) error.details = details;

  return res.status(status).json({
    success: false,
    requestId: res.getHeader("X-Request-Id") || null,
    error,
    timestamp: Date.now()
  });
}

function securityLog(req, event, details = {}) {
  console.warn("[ANOR_SECURITY]", JSON.stringify({
    time: new Date().toISOString(),
    requestId: req.requestId || null,
    ip: req.ip,
    event,
    details
  }));
}

function cleanText(value, maxLength = 150) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim().replace(/\s+/g, " ");
  return result && result.length <= maxLength ? result : null;
}

function normalizeVisualBits(bits) {
  if (Array.isArray(bits)) bits = bits.join("");
  if (typeof bits !== "string") return null;
  const value = bits.replace(/\s/g, "");
  return new RegExp(`^[01]{${VISUAL_BITS_LENGTH}}$`).test(value)
    ? value
    : null;
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) count++;
  }
  return count;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeLocation(value) {
  if (!value || typeof value !== "object") return {};
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng ?? value.long);

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180
  ) {
    return { latitude, longitude };
  }
  return {};
}

function parseImageDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_SCAN_IMAGE_BYTES) return null;
  return { mimeType: match[1], buffer };
}

function normalizeInput(body = {}) {
  const scannedMatrix = body.scannedMatrix ?? null;
  let bits = normalizeVisualBits(body.visualBits);
  let signature = cleanText(body.visualSignature, 200);
  let lot = cleanText(body.lot || body.batch, 100);
  let serialNumber = cleanText(
    body.serial_number || body.serialNumber || body.serie,
    120
  );

  if (scannedMatrix && typeof scannedMatrix === "object") {
    bits ||= normalizeVisualBits(
      scannedMatrix.bits || scannedMatrix.visualBits
    );
    signature ||= cleanText(
      scannedMatrix.signature || scannedMatrix.visualSignature,
      200
    );
    lot ||= cleanText(scannedMatrix.lot || scannedMatrix.batch, 100);
    serialNumber ||= cleanText(
      scannedMatrix.serial_number || scannedMatrix.serialNumber,
      120
    );
  }

  if (typeof scannedMatrix === "string") {
    const value = scannedMatrix.trim();
    if (value.startsWith("ANOR51:")) {
      bits ||= normalizeVisualBits(value.slice(7));
    } else if (!lot && value.length <= 100) {
      // Ancien client : valeur seule = lot, jamais preuve d'authenticité.
      lot = value;
    }
  }

  if (!signature && bits) signature = `ANOR51:${bits}`;

  return { scannedMatrix, bits, signature, lot, serialNumber };
}

function validUserAgent(agent) {
  if (typeof agent !== "string" || !agent.trim() || agent.length > 400) {
    return false;
  }
  return ![
    "sqlmap", "nikto", "burpsuite", "acunetix", "zgrab", "gobuster"
  ].some((x) => agent.toLowerCase().includes(x));
}

/* -------------------- LIMITATION DES REQUÊTES -------------------- */

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    securityLog(req, "RATE_LIMIT_EXCEEDED");
    return apiError(
      res, 429, "TOO_MANY_REQUESTS",
      "Trop de scans. Veuillez réessayer dans une minute."
    );
  }
});

const forgeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

/* -------------------- OCR : EXTRACTION SEULEMENT -------------------- */

function extractIdsFromText(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const normalized = text
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\r/g, "\n");

  const lotMatch =
    normalized.match(/(?:LOT|BATCH|N[°O]\s*LOT)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/_-]{1,99})/i);

  const serialMatch =
    normalized.match(/(?:S[ÉE]RIE|SERIAL|N[°O]\s*S[ÉE]RIE)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/_-]{1,119})/i);

  let lot = lotMatch ? cleanText(lotMatch[1], 100) : null;
  let serialNumber = serialMatch ? cleanText(serialMatch[1], 120) : null;

  // Format courant du manifeste : LOT-000001.
  if (!serialNumber) {
    const candidates = normalized.match(/\b[A-Z0-9][A-Z0-9_-]{2,119}\b/g) || [];
    const serialCandidate = candidates.find((x) => /-\d{4,}$/.test(x));
    if (serialCandidate) {
      serialNumber = cleanText(serialCandidate, 120);
      if (!lot) lot = serialCandidate.replace(/-\d{4,}$/, "");
    }
  }

  return lot || serialNumber ? { lot, serialNumber } : null;
}

async function extractIdsWithOcr(image) {
  if (!image || !tesseract) return null;

  try {
    const result = await tesseract.recognize(
      image.buffer,
      "eng",
      { logger: () => {} }
    );
    const text = result?.data?.text || "";
    const parsed = extractIdsFromText(text);
    if (!parsed) return null;

    const confidence = Number(result?.data?.confidence);
    return {
      ...parsed,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence / 100))
        : 0,
      engine: "TESSERACT_OCR"
    };
  } catch (error) {
    console.warn("[OCR_ERROR]", error.message);
    return null;
  }
}

/* -------------------- MANIFESTE UNITAIRE -------------------- */

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function generateUnitSerialsAndManifest(lotCode, quantity, masterSignature) {
  const rows = [[
    "Index", "Lot", "Numero_De_Serie", "Hachage_Securise"
  ].map(csvEscape).join(",")];

  let pending = [];

  for (let i = 1; i <= quantity; i++) {
    const serialNumber = `${lotCode}-${String(i).padStart(6, "0")}`;
    const secureUnitHash = sha256(
      `${masterSignature}:${lotCode}:${serialNumber}:${i}`
    );

    pending.push({
      lot: lotCode,
      serial_number: serialNumber,
      unit_index: i,
      secure_unit_hash: secureUnitHash,
      statut_unitaire: "ACTIF"
    });

    rows.push([
      i, lotCode, serialNumber, secureUnitHash
    ].map(csvEscape).join(","));

    if (pending.length >= 500 || i === quantity) {
      const { error } = await supabase
        .from("produits_unitaires_serials")
        .upsert(pending, {
          onConflict: "lot,serial_number",
          ignoreDuplicates: false
        });

      if (error) throw error;
      pending = [];
    }
  }

  return rows.join("\n");
}

/* -------------------- FICHIERS STATIQUES -------------------- */

app.use(express.static(path.join(__dirname)));
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));
app.use("/product_audit", express.static(path.join(__dirname, "product_audit")));
app.use("/intelligence", express.static(path.join(__dirname, "intelligence")));
app.use("/surveillance", express.static(path.join(__dirname, "surveillance")));
app.use("/forge", express.static(path.join(__dirname, "forge")));

app.get(["/", "/index.html"], (req, res) => {
  res.redirect("/dashboard/index.html");
});

/* -------------------- SANTÉ DU SERVEUR -------------------- */

app.get("/health", async (req, res) => {
  let database = "DOWN";

  try {
    const { error } = await supabase
      .from("produits_certifies")
      .select("lot")
      .limit(1);
    if (!error) database = "UP";
  } catch (error) {
    console.warn("[HEALTH]", error.message);
  }

  return apiSuccess(res, {
    status: database === "UP" ? "ONLINE" : "DEGRADED",
    engine: `ANOR Core ${SERVER_VERSION}`,
    database,
    ocr: tesseract ? "TESSERACT_CONFIGURED" : "NOT_CONFIGURED",
    visualVersion: VISUAL_VERSION,
    visualBitsLength: VISUAL_BITS_LENGTH,
    uptime: process.uptime()
  });
});

/* -------------------- STATISTIQUES DU TABLEAU DE BORD -------------------- */

app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("produits_certifies")
      .select("lot,nom_produit,nom_producteur,statut,scan_count,created_at,last_scan_location,last_scanned_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;

    const products = data || [];
    const totalScans = products.reduce(
      (sum, item) => sum + (Number(item.scan_count) || 0), 0
    );
    const anomalies = products.filter((item) =>
      ["ALERTE", "CONTREFAÇON", "SUSPICION"].includes(item.statut)
    ).length;

    const flux = products.slice(0, 10).map((item) => ({
      lot: item.lot || "N/A",
      produit: item.nom_produit || "N/A",
      producteur: item.nom_producteur || "N/A",
      localisation: item.last_scan_location || "Inconnue",
      horodatage: item.last_scanned_at
        ? new Date(item.last_scanned_at).toLocaleString("fr-FR")
        : item.created_at
          ? new Date(item.created_at).toLocaleString("fr-FR")
          : "N/A",
      statut: item.statut || "CERTIFIÉ"
    }));

    return apiSuccess(res, {
      totalScans,
      lotsEnregistres: products.length,
      anomalies,
      flux
    });
  } catch (error) {
    console.error("[DASHBOARD_ERROR]", error.message);
    return apiError(
      res, 500, "DASHBOARD_ERROR",
      "Impossible de charger les statistiques."
    );
  }
});

/* -------------------- VÉRIFICATION DU SCEAU ET DE L'UNITÉ -------------------- */

app.post("/api/seals/verify", scanLimiter, async (req, res) => {
  const startedAt = Date.now();

  try {
    if (!validUserAgent(req.headers["user-agent"])) {
      return apiError(res, 400, "INVALID_CLIENT", "Client non valide.");
    }

    const input = normalizeInput(req.body || {});
    let { lot, serialNumber, bits, signature } = input;

    const image = parseImageDataUrl(input.scannedMatrix);
    const location = normalizeLocation(req.body?.location);
    const locationText = cleanText(
      typeof req.body?.location === "string"
        ? req.body.location
        : req.body?.location?.label || req.body?.location?.city,
      200
    ) || "Inconnue";

    const deviceMetadata =
      req.body?.deviceMetadata &&
      typeof req.body.deviceMetadata === "object"
        ? req.body.deviceMetadata
        : {};

    if (!lot && !serialNumber && !bits && !signature && !image) {
      return apiError(
        res, 400, "MISSING_SCAN",
        "Aucune donnée de scan reçue."
      );
    }

    let extractionConfidence = lot && serialNumber ? 1 : 0;
    let verificationMode = "DIRECT_INPUT";

    if ((!lot || !serialNumber) && image) {
      const ocr = await extractIdsWithOcr(image);
      if (ocr) {
        lot ||= ocr.lot;
        serialNumber ||= ocr.serialNumber;
        extractionConfidence = ocr.confidence;
        verificationMode = ocr.engine;
      }
    }

    if (!lot || !serialNumber) {
      return apiSuccess(res, {
        status: "LECTURE_INCOMPLETE",
        verified: false,
        requiresManualConfirmation: true,
        message: "Le lot ou le numéro de série est illisible. Corrigez les informations ou recommencez le scan.",
        lot: lot || null,
        serial_number: serialNumber || null,
        extractionConfidence,
        verificationMode,
        processingTimeMs: Date.now() - startedAt
      });
    }

    lot = cleanText(lot, 100);
    serialNumber = cleanText(serialNumber, 120);

    if (!lot || !serialNumber) {
      return apiError(
        res, 400, "INVALID_IDENTIFIERS",
        "Le lot ou le numéro de série est invalide."
      );
    }

    const { data: master, error: masterError } = await supabase
      .from("produits_certifies")
      .select("*")
      .eq("lot", lot)
      .maybeSingle();

    if (masterError) throw masterError;

    if (!master) {
      securityLog(req, "UNKNOWN_LOT", { lot, serialNumber });
      return apiSuccess(res, {
        status: "LOT_INCONNU",
        verified: false,
        message: "Aucun lot correspondant n'est enregistré.",
        lot,
        serial_number: serialNumber,
        processingTimeMs: Date.now() - startedAt
      });
    }

    const storedBits = normalizeVisualBits(
      master.visual_bits || master.glyph_payload?.visualBits
    );

    let visualMatch = false;
    let distance = null;

    // Une signature transmise par le client ne constitue pas à elle seule
    // une preuve : la comparaison des 51 bits est obligatoire.
    if (bits && storedBits) {
      distance = hammingDistance(bits, storedBits);
      visualMatch = distance <= MAX_HAMMING_DISTANCE;
    }

    if (!storedBits || !bits) {
      return apiSuccess(res, {
        status: "LECTURE_VISUELLE_INCOMPLETE",
        verified: false,
        requiresRecapture: true,
        message: "Les 51 glyphes n'ont pas pu être validés. Recommencez le scan avec une image plus nette.",
        lot,
        serial_number: serialNumber,
        visualMatch: false,
        hammingDistance: distance,
        processingTimeMs: Date.now() - startedAt
      });
    }

    if (!visualMatch) {
      securityLog(req, "VISUAL_SIGNATURE_MISMATCH", {
        lot, serialNumber, hammingDistance: distance
      });

      return apiSuccess(res, {
        status: "SCEAU_NON_CONFORME",
        verified: false,
        message: "Le motif des glyphes ne correspond pas au motif maître enregistré pour ce lot.",
        lot,
        serial_number: serialNumber,
        visualMatch: false,
        hammingDistance: distance,
        processingTimeMs: Date.now() - startedAt
      });
    }

    const { data: unit, error: unitError } = await supabase
      .from("produits_unitaires_serials")
      .select("*")
      .eq("lot", lot)
      .eq("serial_number", serialNumber)
      .maybeSingle();

    if (unitError) throw unitError;

    if (!unit) {
      securityLog(req, "UNREGISTERED_SERIAL", { lot, serialNumber });
      return apiSuccess(res, {
        status: "SERIE_NON_AUTORISEE",
        verified: false,
        message: "Ce numéro de série n'est pas enregistré dans le manifeste du lot.",
        lot,
        serial_number: serialNumber,
        visualMatch: true,
        processingTimeMs: Date.now() - startedAt
      });
    }

    if (unit.statut_unitaire !== "ACTIF") {
      securityLog(req, "INACTIVE_SERIAL", {
        lot, serialNumber, unitStatus: unit.statut_unitaire
      });
      return apiSuccess(res, {
        status: "SERIE_INACTIVE",
        verified: false,
        message: "Ce numéro de série est désactivé ou bloqué.",
        lot,
        serial_number: serialNumber,
        statut_unitaire: unit.statut_unitaire,
        processingTimeMs: Date.now() - startedAt
      });
    }

    const scannedAt = new Date().toISOString();
    const requestId = req.requestId;

    const { error: insertError } = await supabase
      .from("produits_unitaires_scans")
      .insert({
        lot,
        serial_number: serialNumber,
        scanned_at: scannedAt,
        request_id: requestId,
        location_label: locationText,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        location_method: cleanText(req.body?.locationMethod, 60),
        device_metadata: deviceMetadata,
        extraction_confidence: extractionConfidence,
        verification_mode: verificationMode,
        visual_match: true,
        hamming_distance: distance,
        result: "SERIE_AUTORISEE"
      });

    if (insertError) throw insertError;

    const { data: history, error: historyError } = await supabase
      .from("produits_unitaires_scans")
      .select("scanned_at,latitude,longitude,location_label")
      .eq("lot", lot)
      .eq("serial_number", serialNumber)
      .neq("request_id", requestId)
      .order("scanned_at", { ascending: false })
      .limit(20);

    if (historyError) {
      console.warn("[SCAN_HISTORY]", historyError.message);
    }

    const previousScans = history || [];
    let anomaly = null;

    if (previousScans.length) {
      anomaly = {
        type: "SERIAL_PREVIOUSLY_SCANNED",
        severity: "REVIEW",
        message: "Ce numéro a déjà été scanné. Cette répétition nécessite une vérification complémentaire, mais ne prouve pas une fraude."
      };

      const previous = previousScans[0];
      const previousTime = new Date(previous.scanned_at).getTime();
      const elapsedMinutes = (Date.now() - previousTime) / 60000;

      if (
        Number.isFinite(previousTime) &&
        elapsedMinutes >= 0 &&
        elapsedMinutes <= 180 &&
        Number.isFinite(location.latitude) &&
        Number.isFinite(location.longitude) &&
        Number.isFinite(Number(previous.latitude)) &&
        Number.isFinite(Number(previous.longitude))
      ) {
        const rad = (v) => v * Math.PI / 180;
        const dLat = rad(location.latitude - Number(previous.latitude));
        const dLon = rad(location.longitude - Number(previous.longitude));
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(rad(Number(previous.latitude))) *
          Math.cos(rad(location.latitude)) *
          Math.sin(dLon / 2) ** 2;
        const distanceKm =
          6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        if (distanceKm > 100) {
          anomaly = {
            type: "IMPOSSIBLE_TRAVEL_SUSPECTED",
            severity: "HIGH",
            distanceKm: Number(distanceKm.toFixed(1)),
            elapsedMinutes: Number(elapsedMinutes.toFixed(1)),
            message: "Le même numéro a été scanné dans des lieux éloignés sur un intervalle court. Les données de localisation doivent être examinées."
          };
        }
      }
    }

    if (anomaly) {
      securityLog(req, "SERIAL_REUSE_SUSPECTED", {
        lot, serialNumber, anomaly
      });
    }

    const nextScanCount = (Number(master.scan_count) || 0) + 1;

    const { error: updateError } = await supabase
      .from("produits_certifies")
      .update({
        scan_count: nextScanCount,
        last_scan_location: locationText,
        last_scanned_at: scannedAt
      })
      .eq("lot", lot);

    if (updateError) {
      console.warn("[MASTER_UPDATE]", updateError.message);
    }

    return apiSuccess(res, {
      status: anomaly ? "AUTORISE_AVEC_ANOMALIE" : "SERIE_AUTORISEE",
      verified: true,
      unitRegistered: true,
      requiresHumanConfirmation: true,
      message: anomaly
        ? "Le lot, le motif visuel et le numéro sont enregistrés. Une anomalie d'historique est à examiner. Comparez aussi les informations affichées avec le produit physique."
        : "Le lot, le motif visuel et le numéro de série correspondent au registre. Comparez les informations affichées avec le produit physique.",
      lot: master.lot,
      serial_number: unit.serial_number,
      unit_index: unit.unit_index,
      nom_produit: master.nom_produit || "Produit certifié",
      nom_producteur: master.nom_producteur || "Producteur enregistré",
      pays_origine: master.pays_origine || "Cameroun",
      quantite: master.quantite,
      type_emballage: master.type_emballage,
      visuel_produit_url: master.visuel_produit_url || null,
      certificat_pdf_url: master.certificat_pdf_url || null,
      visualMatch: true,
      hammingDistance: distance,
      extractionConfidence,
      previousScanCount: previousScans.length,
      anomaly,
      scan_count: nextScanCount,
      processingTimeMs: Date.now() - startedAt,
      verificationMode,
      engineVersion: SERVER_VERSION
    });
  } catch (error) {
    console.error("[VERIFY_ERROR]", error);
    return apiError(
      res, 500, "VERIFY_ERROR",
      isProduction
        ? "Erreur interne pendant la vérification."
        : error.message
    );
  }
});

/* -------------------- GÉNÉRATION DU SCEAU MAÎTRE -------------------- */

app.post(
  "/api/seals/generate-batch-seal",
  forgeLimiter,
  upload.fields([
    { name: "certificat_pdf", maxCount: 1 },
    { name: "visuel_produit", maxCount: 1 }
  ]),
  async (req, res) => {
    const startedAt = Date.now();

    try {
      const lot = cleanText(req.body?.lot, 100);
      const productName = cleanText(req.body?.nom_produit, 200);
      const producerName = cleanText(req.body?.nom_producteur, 200);
      const packageType = cleanText(req.body?.type_emballage, 100);
      const quantity = Number.parseInt(req.body?.quantite, 10);

      if (!lot || !quantity || !packageType) {
        return apiError(
          res, 400, "MISSING_PARAMETERS",
          "Champs requis : lot, quantite et type_emballage."
        );
      }

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_BATCH_QUANTITY
      ) {
        return apiError(
          res, 400, "INVALID_QUANTITY",
          `La quantité doit être comprise entre 1 et ${MAX_BATCH_QUANTITY}.`
        );
      }

      const { data: existing, error: existingError } = await supabase
        .from("produits_certifies")
        .select("*")
        .eq("lot", lot)
        .maybeSingle();

      if (existingError) throw existingError;

      let secureSignature;
      let visualBits;
      let visualSignature;

      if (existing) {
        secureSignature = existing.glyph_payload?.secureSignature || null;
        visualBits = normalizeVisualBits(
          existing.visual_bits || existing.glyph_payload?.visualBits
        );
        visualSignature = existing.visual_signature || null;

        if (!secureSignature || !visualBits || !visualSignature) {
          return apiError(
            res, 409, "MASTER_SEAL_INCOMPLETE",
            "Le sceau maître existant est incomplet. Une vérification technique est nécessaire."
          );
        }

        if (Number(existing.quantite) !== quantity) {
          return apiError(
            res, 409, "QUANTITY_CHANGE_REQUIRES_REVIEW",
            "La quantité d'un lot existant ne peut pas être modifiée par cette route."
          );
        }
      } else {
        secureSignature = crypto.randomBytes(32).toString("hex");
        visualBits = normalizeVisualBits(
          SealRenderer.deriveVisualBits(secureSignature)
        );

        if (!visualBits) {
          throw new Error("Le renderer a produit un motif de glyphes invalide.");
        }

        visualSignature = `ANOR51:${visualBits}`;
      }

      const masterImage = await SealRenderer.renderSealToBuffer(
        {
          secureSignature,
          visualBits,
          lot
        },
        {
          lot,
          nom_produit: productName,
          nom_producteur: producerName,
          type_emballage: packageType
        }
      );

      const payloadDB = {
        certificate_code: lot,
        lot,
        quantite: quantity,
        type_emballage: packageType,
        nom_produit: productName,
        nom_producteur: producerName,
        glyph_payload: {
          visualVersion: VISUAL_VERSION,
          secureSignature,
          lot,
          visualBits,
          visualSignature
        },
        visual_bits: visualBits,
        visual_signature: visualSignature,
        engine_version: SERVER_VERSION,
        statut: existing?.statut || "CERTIFIÉ",
        scan_count: Number(existing?.scan_count) || 0
      };

      const { error: saveError } = await supabase
        .from("produits_certifies")
        .upsert(payloadDB, { onConflict: "lot" });

      if (saveError) throw saveError;

      const manifestCsv = await generateUnitSerialsAndManifest(
        lot, quantity, secureSignature
      );

      const certification = {
        protocol: "ANOR_CHECK",
        serverVersion: SERVER_VERSION,
        visualVersion: VISUAL_VERSION,
        visualBitsLength: VISUAL_BITS_LENGTH,
        lot,
        quantite: quantity,
        visualBits,
        visualSignature,
        secureSignature,
        serialRule: `${lot}-000001 ... ${lot}-${String(quantity).padStart(6, "0")}`,
        glyphsCommonToAllUnits: true,
        onlyVariablePerUnit: "serial_number",
        generatedAt: new Date().toISOString()
      };

      const zip = new JSZip();
      zip.file("sceau_ANOR_MASTER.png", masterImage);
      zip.file("manifeste_serialisation_unitaire.csv", manifestCsv);
      zip.file("certification.json", JSON.stringify(certification, null, 2));
      zip.file(
        "NOTICE_IMPRESSION.txt",
        [
          "ANOR CHECK — NOTICE D'IMPRESSION",
          "",
          `Lot : ${lot}`,
          `Quantité autorisée : ${quantity}`,
          "",
          "Le motif de 51 glyphes est commun à toutes les unités du lot.",
          "Le numéro de série est la seule donnée variable par unité.",
          "Utiliser le manifeste CSV pour l'impression variable.",
          "Ne pas modifier les glyphes, le lot ou l'ordre des numéros.",
          ""
        ].join("\n")
      );

      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });

      return apiSuccess(res, {
        message: existing
          ? "Manifeste régénéré avec le sceau maître existant."
          : "Sceau maître et manifeste générés.",
        lot,
        quantite: quantity,
        visualBits,
        visualSignature,
        imageUrl: `data:image/png;base64,${masterImage.toString("base64")}`,
        manifestCsv,
        kitUrl: `data:application/zip;base64,${zipBuffer.toString("base64")}`,
        processingTimeMs: Date.now() - startedAt
      });
    } catch (error) {
      console.error("[FORGE_ERROR]", error);
      return apiError(
        res, 500, "FORGE_ERROR",
        isProduction
          ? "Erreur pendant la génération du lot."
          : error.message
      );
    }
  }
);

/* -------------------- GESTION DES ERREURS -------------------- */

app.use((err, req, res, next) => {
  if (err?.message === "CORS_ORIGIN_NOT_ALLOWED") {
    return apiError(res, 403, "CORS_DENIED", "Origine non autorisée.");
  }

  if (err instanceof multer.MulterError) {
    return apiError(res, 400, "UPLOAD_ERROR", err.message);
  }

  console.error("[EXPRESS_ERROR]", err);
  return apiError(
    res, 500, "SERVER_ERROR",
    isProduction ? "Erreur interne du serveur." : err.message
  );
});

app.use((req, res) => {
  return apiError(res, 404, "NOT_FOUND", "Route API introuvable.");
});

/* -------------------- DÉMARRAGE -------------------- */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("==============================================");
  console.log(`ANOR CHECK Backend v${SERVER_VERSION}`);
  console.log(`Port : ${PORT}`);
  console.log(`Visual version : ${VISUAL_VERSION}`);
  console.log(`Glyphes par sceau : ${VISUAL_BITS_LENGTH}`);
  console.log("Architecture : 1 sceau maître par lot");
  console.log("Variable unitaire : numéro de série uniquement");
  console.log("==============================================");
});

function shutdown(signal) {
  console.log(`[ANOR] Arrêt demandé : ${signal}`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));