
/**
 * ANOR CHECK — SEAL RENDERER V8.0
 * ----------------------------------------------------
  */

import crypto from "node:crypto";
import sharp from "sharp";

const VISUAL_BITS_LENGTH = 51;
const VISUAL_VERSION = 2;

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 600;

const COLORS = {
  background: "#ffffff",
  ink: "#142b3c",
  muted: "#526575",
  border: "#18394e",
  glyph: "#102c40",
  accent: "#b58b42",
  light: "#e8eef2",
  white: "#ffffff"
};

const GLYPH_TYPES = [
  "square",
  "rect",
  "circle",
  "diamond",
  "plus"
];

const GEOMETRY = {
  innerCount: 7,
  middleCount: 24,
  outerCount: 20,
  innerRadius: 48,
  middleRadius: 105,
  outerRadius: 165
};

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest();
}

/**
 * Génère les 51 bits de référence du sceau maître.
 *
 * À appeler lors de la création du lot avec une signature maîtresse
 * stable et enregistrée en base de données.
 *
 * Ne pas lui transmettre un numéro de série.
 */
function deriveVisualBits(secureSignature) {
  if (
    secureSignature === undefined ||
    secureSignature === null ||
    String(secureSignature).trim() === ""
  ) {
    throw new Error("Une signature sécurisée du lot est requise.");
  }

  const seed = `ANOR_VISUAL_V${VISUAL_VERSION}:${String(secureSignature)}`;
  let bitString = "";
  let counter = 0;

  while (bitString.length < VISUAL_BITS_LENGTH) {
    const digest = sha256(`${seed}:${counter}`);
    bitString += Array.from(digest)
      .map((byte) => byte.toString(2).padStart(8, "0"))
      .join("");
    counter += 1;
  }

  return bitString.slice(0, VISUAL_BITS_LENGTH);
}

/**
 * Répartit les 51 glyphes sur trois couronnes :
 * 7 glyphes intérieurs, 24 intermédiaires et 20 extérieurs.
 *
 * La géométrie dépend uniquement de la version du protocole,
 * jamais du numéro de série.
 */
function getVisiblePositions() {
  const positions = [];
  let index = 0;

  const addRing = (count, radius, startAngle = -Math.PI / 2) => {
    for (let i = 0; i < count; i += 1) {
      const angle = startAngle + (2 * Math.PI * i) / count;

      positions.push({
        index,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
        type: GLYPH_TYPES[index % GLYPH_TYPES.length],
        ring:
          radius === GEOMETRY.innerRadius
            ? "inner"
            : radius === GEOMETRY.middleRadius
              ? "middle"
              : "outer"
      });

      index += 1;
    }
  };

  // Répartition fixe : 7 + 24 + 20 = 51 glyphes.
  addRing(GEOMETRY.innerCount, GEOMETRY.innerRadius, -Math.PI / 2);
  addRing(GEOMETRY.middleCount, GEOMETRY.middleRadius, -Math.PI / 2);
  addRing(GEOMETRY.outerCount, GEOMETRY.outerRadius, -Math.PI / 2);

  return positions;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeBits(bits) {
  if (Array.isArray(bits)) {
    bits = bits.join("");
  }

  const normalized = String(bits ?? "").replace(/\s/g, "");

  if (
    normalized.length !== VISUAL_BITS_LENGTH ||
    !/^[01]+$/.test(normalized)
  ) {
    throw new Error(
      `La signature visuelle doit contenir exactement ${VISUAL_BITS_LENGTH} bits binaires.`
    );
  }

  return normalized;
}

function glyphSvg(type, bit, x, y, size = 15) {
  const fill = bit === "1" ? COLORS.glyph : COLORS.white;
  const stroke = COLORS.glyph;
  const half = size / 2;

  switch (type) {
    case "square":
      return `
        <rect
          x="${x - half}" y="${y - half}"
          width="${size}" height="${size}"
          rx="1.5"
          fill="${fill}" stroke="${stroke}" stroke-width="2"
        />`;

    case "rect":
      return `
        <rect
          x="${x - size * 0.9}" y="${y - size * 0.32}"
          width="${size * 1.8}" height="${size * 0.64}"
          rx="1.5"
          fill="${fill}" stroke="${stroke}" stroke-width="2"
        />`;

    case "circle":
      return `
        <circle
          cx="${x}" cy="${y}" r="${half}"
          fill="${fill}" stroke="${stroke}" stroke-width="2"
        />`;

    case "diamond":
      return `
        <polygon
          points="${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}"
          fill="${fill}" stroke="${stroke}" stroke-width="2"
        />`;

    case "plus":
      return `
        <path
          d="M ${x - half} ${y} H ${x + half} M ${x} ${y - half} V ${y + half}"
          fill="none" stroke="${stroke}" stroke-width="3"
          stroke-linecap="square"
        />
        <circle cx="${x}" cy="${y}" r="2.2" fill="${fill}" />`;

    default:
      throw new Error(`Type de glyphe inconnu : ${type}`);
  }
}

/**
 * Repères asymétriques pour aider à reconnaître l'orientation du sceau.
 * Ils sont fixes et ne représentent pas des bits supplémentaires.
 */
function finderMarksSvg(cx, cy) {
  const marks = [
    { angle: 0, radius: 205 },
    { angle: Math.PI / 2, radius: 205 },
    { angle: Math.PI, radius: 205 }
  ];

  return marks
    .map(({ angle, radius }) => {
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      return `
        <g transform="translate(${x} ${y}) rotate(${(angle * 180) / Math.PI})">
          <rect x="-9" y="-9" width="18" height="18"
                fill="${COLORS.white}" stroke="${COLORS.accent}" stroke-width="3"/>
          <rect x="-4" y="-4" width="8" height="8"
                fill="${COLORS.accent}"/>
        </g>`;
    })
    .join("");
}

function buildSealSvg(payload = {}, options = {}) {
  const width = Number(options.width) || DEFAULT_WIDTH;
  const height = Number(options.height) || DEFAULT_HEIGHT;

  const lot = String(payload.lot ?? options.lot ?? "").trim();
  const product = String(
    payload.nom_produit ?? options.nom_produit ?? "PRODUIT CERTIFIÉ"
  ).trim();
  const producer = String(
    payload.nom_producteur ?? options.nom_producteur ?? ""
  ).trim();

  // Le numéro de série est une donnée imprimée indépendante des glyphes.
  const serialNumber = String(
    payload.itemNumber ??
    options.itemNumber ??
    payload.serial_number ??
    options.serial_number ??
    ""
  ).trim();

  const visualBits = normalizeBits(
    payload.visualBits ?? options.visualBits
  );

  if (!lot) {
    throw new Error("Le numéro de lot est requis pour le rendu du sceau.");
  }

  const cx = 260;
  const cy = 285;
  const positions = getVisiblePositions();

  const glyphs = positions
    .map((position) => {
      const bit = visualBits[position.index];
      return glyphSvg(
        position.type,
        bit,
        cx + position.x,
        cy + position.y,
        position.ring === "outer" ? 13 : 15
      );
    })
    .join("");

  const safeLot = escapeXml(lot);
  const safeProduct = escapeXml(product);
  const safeProducer = escapeXml(producer);
  const safeSerial = escapeXml(serialNumber || "À IMPRIMER");

  const serialLabel = serialNumber
    ? safeSerial
    : "NUMÉRO DE SÉRIE";

  const serialSubLabel = serialNumber
    ? "IDENTIFIANT UNITAIRE"
    : "VARIABLE À L'IMPRESSION";

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg"
       width="${width}" height="${height}"
       viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${COLORS.background}"/>

    <rect x="12" y="12" width="${width - 24}" height="${height - 24}"
          rx="20" fill="none" stroke="${COLORS.border}" stroke-width="4"/>
    <rect x="22" y="22" width="${width - 44}" height="${height - 44}"
          rx="15" fill="none" stroke="${COLORS.accent}" stroke-width="1.5"/>

    <!-- Bandeau institutionnel -->
    <text x="48" y="65"
          font-family="Arial, Helvetica, sans-serif"
          font-size="25" font-weight="700"
          letter-spacing="2" fill="${COLORS.ink}">
      ANOR CHECK
    </text>
    <text x="48" y="91"
          font-family="Arial, Helvetica, sans-serif"
          font-size="12" letter-spacing="1.5"
          fill="${COLORS.muted}">
      IDENTIFICATION ET VÉRIFICATION DU PRODUIT
    </text>

    <line x1="48" y1="111" x2="${width - 48}" y2="111"
          stroke="${COLORS.light}" stroke-width="2"/>

    <!-- Motif commun à toutes les unités du lot -->
    <g>
      <circle cx="${cx}" cy="${cy}" r="222"
              fill="none" stroke="${COLORS.border}" stroke-width="3"/>
      <circle cx="${cx}" cy="${cy}" r="213"
              fill="none" stroke="${COLORS.accent}" stroke-width="1.5"/>
      <circle cx="${cx}" cy="${cy}" r="190"
              fill="none" stroke="${COLORS.light}" stroke-width="1.5"/>
      ${glyphs}
      ${finderMarksSvg(cx, cy)}
      <circle cx="${cx}" cy="${cy}" r="27"
              fill="${COLORS.white}" stroke="${COLORS.border}" stroke-width="2"/>
      <text x="${cx}" y="${cy + 5}"
            text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif"
            font-size="13" font-weight="700"
            fill="${COLORS.ink}">ANOR</text>
    </g>

    <!-- Informations imprimées -->
    <g font-family="Arial, Helvetica, sans-serif">
      <text x="520" y="155" font-size="13"
            font-weight="700" letter-spacing="1.5"
            fill="${COLORS.muted}">PRODUIT</text>
      <text x="520" y="184" font-size="21"
            font-weight="700" fill="${COLORS.ink}">
        ${safeProduct}
      </text>

      <text x="520" y="226" font-size="13"
            font-weight="700" letter-spacing="1.5"
            fill="${COLORS.muted}">PRODUCTEUR</text>
      <text x="520" y="251" font-size="17"
            fill="${COLORS.ink}">
        ${safeProducer || "NON RENSEIGNÉ"}
      </text>

      <line x1="520" y1="276" x2="${width - 55}" y2="276"
            stroke="${COLORS.light}" stroke-width="2"/>

      <text x="520" y="310" font-size="13"
            font-weight="700" letter-spacing="1.5"
            fill="${COLORS.muted}">NUMÉRO DE LOT</text>
      <text x="520" y="346" font-size="27"
            font-weight="700" fill="${COLORS.ink}">
        ${safeLot}
      </text>

      <text x="520" y="397" font-size="13"
            font-weight="700" letter-spacing="1.5"
            fill="${COLORS.muted}">${serialSubLabel}</text>
      <rect x="510" y="412" width="${width - 565}" height="64"
            rx="8" fill="${COLORS.light}" stroke="${COLORS.border}" stroke-width="1.5"/>
      <text x="530" y="453" font-size="25"
            font-weight="700" letter-spacing="1"
            fill="${COLORS.ink}">
        ${serialLabel}
      </text>

      <text x="520" y="510" font-size="12"
            fill="${COLORS.muted}">
        Motif maître commun au lot — Série unitaire variable
      </text>
    </g>

    <!-- Pied de sceau -->
    <line x1="48" y1="${height - 65}" x2="${width - 48}" y2="${height - 65}"
          stroke="${COLORS.light}" stroke-width="2"/>
    <text x="48" y="${height - 38}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="12" letter-spacing="1"
          fill="${COLORS.muted}">
      SCEAU DE TRAÇABILITÉ — V${VISUAL_VERSION}
    </text>
    <text x="${width - 48}" y="${height - 38}"
          text-anchor="end"
          font-family="Arial, Helvetica, sans-serif"
          font-size="12" font-weight="700"
          fill="${COLORS.ink}">
      ${VISUAL_BITS_LENGTH} GLYPHES
    </text>
  </svg>`;
}

/**
 * Produit le sceau au format PNG.
 *
 * Important :
 * - visualBits doit être la signature du sceau maître du lot.
 * - itemNumber/serial_number ne modifie que le texte imprimé.
 * - Pour deux numéros de série différents, fournir le même visualBits.
 */
async function renderSealToBuffer(payload = {}, options = {}) {
  const svg = buildSealSvg(payload, options);
  const width = Number(options.width) || DEFAULT_WIDTH;
  const height = Number(options.height) || DEFAULT_HEIGHT;

  return sharp(Buffer.from(svg, "utf8"))
    .resize(width, height, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const SealRenderer = {
  VISUAL_VERSION,
  VISUAL_BITS_LENGTH,
  GLYPH_TYPES,
  deriveVisualBits,
  getVisiblePositions,
  renderSealToBuffer
};

export {
  VISUAL_VERSION,
  VISUAL_BITS_LENGTH,
  deriveVisualBits,
  getVisiblePositions,
  renderSealToBuffer
};

export default SealRenderer;