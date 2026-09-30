/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V7.0 - QR DECODER READY
 * ====================================================================
 */

const GlyphsLibrary = {
    types: ["square", "rect", "circle", "diamond", "plus"],
    VERSION: "7.0.0",

    TRUTHMODE: {
        emptyThreshold: 0.38,  // Plus strict pour éviter les faux positifs en faible luminosité
        fullThreshold: 0.62,   // Plus strict pour valider l'état plein
        validationMargin: 0.05,
        minimumConfidence: 0.90,
        reconstructionThreshold: 0.70
    },

    MEASUREMENT: {
        passes: 5,
        minimumCoverage: 0.60,
        edgeTolerance: 0.15,
        minimumGlyphPixels: 4,
        reconstructionSize: 32
    },

    definitions: {
        square: { type: "square", width: 18, height: 18, areaModel: "rectangle", reconstruction: "square" },
        rect: { type: "rect", width: 36, height: 9, areaModel: "rectangle", reconstruction: "rectangle" },
        circle: { type: "circle", width: 18, height: 18, radius: 9, areaModel: "circle", reconstruction: "circle" },
        diamond: { type: "diamond", width: 16, height: 16, rotation: 45, areaModel: "diamond", reconstruction: "diamond" },
        plus: { type: "plus", width: 20, height: 20, symbol: "+", areaModel: "plus", reconstruction: "plus" }
    },

    resolveGlyph(index) {
        const safeIndex = Number.isFinite(Number(index)) ? Math.abs(Math.floor(Number(index))) : 0;
        return this.types[safeIndex % this.types.length];
    },

    getGlyphDefinition(type) {
        if (!type || !this.definitions[type]) {
            return { type: "unknown", width: 18, height: 18, areaModel: "rectangle", reconstruction: "rectangle" };
        }
        return { ...this.definitions[type] };
    },

    normalizeFillRatio(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.max(0, Math.min(1, number));
    },

    classifyFill(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        if (ratio <= this.TRUTHMODE.emptyThreshold) return "EMPTY";
        if (ratio >= this.TRUTHMODE.fullThreshold) return "FULL";
        return "UNCERTAIN";
    },

    stateToBit(state) {
        if (state === "FULL") return 1;
        if (state === "EMPTY") return 0;
        return null;
    },

    calculateConfidence(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        const emptyTh = this.TRUTHMODE.emptyThreshold;
        const fullTh = this.TRUTHMODE.fullThreshold;

        if (ratio <= emptyTh) return Number(Math.min(1, (emptyTh - ratio) / emptyTh + 0.5).toFixed(3));
        if (ratio >= fullTh) return Number(Math.min(1, (ratio - fullTh) / (1 - fullTh) + 0.5).toFixed(3));

        const distance = Math.min(ratio - emptyTh, fullTh - ratio);
        return Number(Math.max(0, 0.5 - distance).toFixed(3));
    },

    analyzeGlyph(type, fillRatio, options = {}) {
        const glyph = this.getGlyphDefinition(type);
        const ratio = this.normalizeFillRatio(fillRatio);
        const state = this.classifyFill(ratio);
        const confidence = this.calculateConfidence(ratio);
        let bit = this.stateToBit(state);

        if (options.strict === true && state === "UNCERTAIN") {
            bit = null;
        }

        return {
            type: glyph.type,
            geometry: glyph.reconstruction,
            fillRatio: ratio,
            state,
            bit,
            confidence,
            reliable: (bit !== null && confidence >= this.TRUTHMODE.minimumConfidence),
            needsReconstruction: (confidence < this.TRUTHMODE.minimumConfidence),
            definition: glyph
        };
    }
};

if (typeof module !== "undefined" && module.exports) module.exports = GlyphsLibrary;
if (typeof window !== "undefined") window.GlyphsLibrary = GlyphsLibrary;