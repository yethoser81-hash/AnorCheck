/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V7.0 - QR-LOGIC OPTIMIZED
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 2;
const VISIBLE_GLYPH_COUNT = 51;
const CANONICAL_OUTER_RADIUS = 375;

const sealRenderer = {

    deriveVisualBits(seed) {
        const digest = crypto
            .createHash('sha256')
            .update(`ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`)
            .digest();

        let bits = '';
        for (const byte of digest) {
            bits += byte.toString(2).padStart(8, '0');
        }

        return bits.slice(0, VISIBLE_GLYPH_COUNT);
    },

    normalizeVisualBits(bits) {
        if (typeof bits === 'string' && /^[01]{51}$/.test(bits)) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (GlyphsLibrary && typeof GlyphsLibrary.resolveGlyph === 'function') {
            return GlyphsLibrary.resolveGlyph(visibleIndex);
        }
        const types = ['square', 'rect', 'circle', 'diamond', 'plus'];
        return types[visibleIndex % types.length];
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 25;
        const centerX = width / 2;
        const centerY = height / 2;
        const logoSize = 220;
        const logoRadius = logoSize / 2;

        const innerRingRadius = logoRadius + 45;
        const outerRingRadius = outerRadius - 30;
        const midRingRadius = (innerRingRadius + outerRingRadius) / 2;

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            innerRingRadius,
            midRingRadius,
            outerRingRadius
        };
    },

    getFinderAngles() {
        return [
            0,             // Droite (0 rad)
            Math.PI / 2,   // Haut (PI/2 rad)
            Math.PI        // Gauche (PI rad)
        ];
    },

    isOuterFinderCollision(angle) {
        for (const targetAngle of this.getFinderAngles()) {
            let diff = Math.abs(angle - targetAngle);
            if (diff > Math.PI) {
                diff = (Math.PI * 2) - diff;
            }
            if (diff < 0.31) {
                return true;
            }
        }
        return false;
    },

    getVisiblePositions() {
        const positions = [];

        // Anneau interne : 7 glyphes
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const deg = angle * 180 / Math.PI;
            if (deg >= 20 && deg <= 160) continue;
            positions.push({ ring: 'inner', ringPosition: i, theoreticalCount: 12 });
        }

        // Anneau médian : 24 glyphes
        for (let i = 0; i < 24; i++) {
            positions.push({ ring: 'middle', ringPosition: i, theoreticalCount: 24 });
        }

        // Anneau externe : 20 glyphes
        for (let i = 0; i < 32; i++) {
            const angle = (i / 32) * Math.PI * 2;
            if (this.isOuterFinderCollision(angle)) continue;
            positions.push({ ring: 'outer', ringPosition: i, theoreticalCount: 32 });
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const GEOMETRY_COLOR = options.geometryColor || '#3B9CFF';
        const backgroundColor = options.backgroundColor;

        const geometry = this.getGeometry(width, height);
        const {
            centerX, centerY, outerRadius, logoSize, logoRadius,
            innerRingRadius, midRingRadius, outerRingRadius
        } = geometry;

        if (backgroundColor) {
            ctx.save();
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        }

        // 1. LOT & IDENTIFICATION
        const rawBatchName = payload.lot || payload.batchNumber || payload.batchName || options.lot || 'DEMO';
        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.startsWith('LOT') ? normalizedBatchName : `LOT ${normalizedBatchName}`;
        const rawItemNumber = payload.itemNumber ?? options.itemNumber;
        const itemText = rawItemNumber ? `N° ${rawItemNumber}` : 'DM / 000 000';

        // 2. MATRICE DE BITS
        const secureSignature = payload.secureSignature || null;
        const suppliedVisualBits = payload.visualBits;
        const visualBits = this.normalizeVisualBits(suppliedVisualBits) || this.deriveVisualBits(secureSignature || rawBatchName);

        // 3. CERCLE EXTÉRIEUR & ANNEAU DE SYNCHRONISATION
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, (innerRingRadius + midRingRadius) / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 4. LOGO CENTRAL
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(img, centerX - logoRadius, centerY - logoRadius - 35, logoSize, logoSize);
            } catch (e) {
                console.error('[sealRenderer] Erreur chargement logo:', e);
            }
        }

        // 5. RENDU DES GLYPHES
        const positions = this.getVisiblePositions();
        const glyphScale = options.glyphScale || 1.20;
        const strokeWidth = options.glyphStrokeWidth || 4;

        const rings = { inner: innerRingRadius, middle: midRingRadius, outer: outerRingRadius };

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = strokeWidth;

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const position = positions[visibleIndex];
            const radius = rings[position.ring];
            const angle = (position.ringPosition / position.theoreticalCount) * Math.PI * 2;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            drawGlyphFromDefinition(ctx, glyphType, glyphDef, isFilled, glyphScale, strokeWidth);
            ctx.restore();
        }
        ctx.restore();

        // 6. LES 3 MIRES CARDINALES ASYMÉTRIQUES
        const finderSize = Math.max(30, Math.round((outerRadius / CANONICAL_OUTER_RADIUS) * 44));
        const finderCore = Math.max(12, Math.round(finderSize * 0.40));

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.max(4, Math.round((outerRadius / CANONICAL_OUTER_RADIUS) * 5));

        for (const targetAngle of this.getFinderAngles()) {
            const px = centerX + outerRingRadius * Math.cos(targetAngle);
            const py = centerY + outerRingRadius * Math.sin(targetAngle);

            ctx.save();
            ctx.translate(px, py);
            ctx.strokeRect(-finderSize / 2, -finderSize / 2, finderSize, finderSize);
            ctx.fillRect(-finderCore / 2, -finderCore / 2, finderCore, finderCore);
            ctx.restore();
        }
        ctx.restore();

        // 7. TEXTE DU LOT ET NUMÉRO
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const scale = outerRadius / CANONICAL_OUTER_RADIUS;
        const textY = centerY + 115 * scale;

        const drawOutlinedText = (text, x, y, font, color) => {
            ctx.font = font;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = Math.max(4, 5.5 * scale);
            ctx.strokeText(text, x, y);
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
        };

        drawOutlinedText(batchText, centerX, textY - 18 * scale, `bold ${Math.max(20, Math.round(28 * scale))}px sans-serif`, '#FFFFFF');
        drawOutlinedText(itemText, centerX, textY + 22 * scale, `bold ${Math.max(19, Math.round(26 * scale))}px monospace`, '#E2E8F0');
        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4) {
    const width = def.width * glyphScale;
    const height = def.height * glyphScale;
    ctx.lineWidth = strokeWidth;

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) ctx.fillRect(-width / 2, -height / 2, width, height);
            else ctx.strokeRect(-width / 2, -height / 2, width, height);
            break;
        case 'circle':
            ctx.beginPath();
            ctx.arc(0, 0, (def.radius || def.width / 2) * glyphScale, 0, Math.PI * 2);
            if (isFilled) ctx.fill(); else ctx.stroke();
            break;
        case 'diamond':
            ctx.save();
            ctx.rotate((def.rotation || 45) * Math.PI / 180);
            if (isFilled) ctx.fillRect(-width / 2, -height / 2, width, height);
            else ctx.strokeRect(-width / 2, -height / 2, width, height);
            ctx.restore();
            break;
        case 'plus':
            const arm = Math.max(strokeWidth * 1.35, width * 0.18);
            if (isFilled) {
                ctx.fillRect(-width / 2, -arm / 2, width, arm);
                ctx.fillRect(-arm / 2, -height / 2, arm, height);
            } else {
                ctx.beginPath();
                ctx.moveTo(-width / 2, 0); ctx.lineTo(width / 2, 0);
                ctx.moveTo(0, -height / 2); ctx.lineTo(0, height / 2);
                ctx.stroke();
            }
            break;
    }
}

module.exports = sealRenderer;