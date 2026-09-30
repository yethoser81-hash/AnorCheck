/**
 * ============================================================
 * ANOR SEAL RENDERER V7
 * ============================================================
 *
 * Renderer officiel du sceau ANOR V7.
 *
 * PRINCIPES :
 *
 * - 600 DPI
 * - 15 x 20 mm minimum
 * - référence OCR-first
 * - checksum V7
 * - lot lisible
 * - série lisible
 * - sérialisation compacte ANOR
 * - logo ANOR
 * - filigrane institutionnel très léger
 * - zones OCR propres
 * - bordure dorée arrondie
 *
 * PRIORITÉ :
 *
 * 1. lecture OCR
 * 2. contraste
 * 3. stabilité graphique
 * 4. esthétique
 *
 * ============================================================
 */

const fs =
    require("fs");

const path =
    require("path");

const {
    createCanvas,
    loadImage
} =
    require("canvas");

const Format =
    require(
        "../library/AnorSealFormatV7"
    );


// ============================================================
// CONFIGURATION
// ============================================================

const DPI =
    600;

const WIDTH_MM =
    Format.MIN_WIDTH_MM;

const HEIGHT_MM =
    Format.MIN_HEIGHT_MM;

const MM_TO_PX =
    DPI / 25.4;

const DEFAULT_WIDTH =
    Math.round(
        WIDTH_MM *
        MM_TO_PX
    );

const DEFAULT_HEIGHT =
    Math.round(
        HEIGHT_MM *
        MM_TO_PX
    );


// ============================================================
// MM -> PX
// ============================================================

function mm(value) {

    return Math.round(
        value *
        MM_TO_PX
    );
}


// ============================================================
// POLICE
// ============================================================
//
// Priorité à une police standard robuste pour OCR.
// Pas de police décorative par défaut.
//
// ============================================================

const fontName =
    "Arial";


// ============================================================
// AJUSTEMENT POLICE
// ============================================================

function fitFont(
    ctx,
    text,
    maxWidth,
    initialSize,
    family
) {

    let size =
        Math.max(
            8,
            Math.round(
                initialSize
            )
        );

    while (
        size > 8
    ) {

        ctx.font =
            `bold ${size}px ${family}`;

        if (
            ctx.measureText(
                text
            ).width <=
            maxWidth
        ) {

            return size;
        }

        size -= 1;
    }

    return size;
}


// ============================================================
// NORMALISATION SÉRIE
// ============================================================
//
// Accepte :
//
// - nombre numérique
// - chaîne numérique
// - code ANOR compact déjà valide
//
// Exemple :
//
// 1000  -> M
// 1100  -> MC
// 100000 -> CM
//
// ============================================================

function normalizeSerie(
    serie
) {

    if (
        serie === undefined ||
        serie === null ||
        String(serie).trim() === ""
    ) {

        return "0";
    }

    const candidate =
        String(serie)
            .trim()
            .toUpperCase()
            .replace(
                /\s+/g,
                ""
            );


    /*
     * Code compact déjà valide.
     */

    const parsed =
        Format.validateSerial(
            candidate
        );

    if (
        parsed.valid
    ) {

        return parsed.canonical;
    }


    /*
     * Numéro numérique éventuellement
     * avec des zéros initiaux.
     *
     * Exemple :
     * 000000 -> 0
     * 000001 -> 1
     * 000100 -> 100
     * 001000 -> M
     */

    if (
        /^\d+$/.test(
            candidate
        )
    ) {

        return Format.encodeSerial(
            candidate
        );
    }


    throw new Error(
        `Série V7 invalide : ${candidate}`
    );
}


// ============================================================
// RENDU
// ============================================================

async function renderSealToBuffer(
    data = {}
) {

    const {

        reference,

        lot,

        serie,

        logoPath,

        width =
            DEFAULT_WIDTH,

        height =
            DEFAULT_HEIGHT

    } = data;


    // ========================================================
    // VALIDATION REFERENCE
    // ========================================================

    if (!reference) {

        throw new Error(
            "Référence V7 obligatoire."
        );
    }


    const parsedReference =
        Format.validateReference(
            reference
        );


    if (
        !parsedReference.valid
    ) {

        throw new Error(
            `Référence V7 invalide : ${parsedReference.reason}`
        );
    }


    // ========================================================
    // VALIDATION LOT
    // ========================================================

    if (
        lot === undefined ||
        lot === null ||
        String(lot).trim() === ""
    ) {

        throw new Error(
            "Lot obligatoire."
        );
    }


    // ========================================================
    // VALIDATION / NORMALISATION SÉRIE
    // ========================================================

    const normalizedSerie =
        normalizeSerie(
            serie
        );


    // ========================================================
    // CANVAS
    // ========================================================

    const canvas =
        createCanvas(
            width,
            height
        );

    const ctx =
        canvas.getContext(
            "2d"
        );


    // ========================================================
    // TRANSPARENT
    // ========================================================

    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    // ========================================================
    // BORDURE
    // ========================================================

    const border =
        Math.max(
            3,
            mm(0.35)
        );

    const radius =
        mm(1.2);


    // ========================================================
    // MASQUE BLANC
    // ========================================================

    ctx.save();

    ctx.beginPath();

    ctx.roundRect(

        border,

        border,

        width -
            border * 2,

        height -
            border * 2,

        radius
    );

    ctx.fillStyle =
        "#FFFFFF";

    ctx.fill();

    ctx.clip();


    // ========================================================
    // LOGO
    // ========================================================

    const resolvedLogo =
        logoPath ||
        path.join(
            __dirname,
            "../assets/logo_anor_master.png"
        );


    if (
        fs.existsSync(
            resolvedLogo
        )
    ) {

        try {

            const logo =
                await loadImage(
                    resolvedLogo
                );


            // ====================================================
            // FILIGRANE INSTITUTIONNEL
            // ====================================================
            //
            // Très faible opacité.
            //
            // Il reste derrière la composition générale,
            // mais aucune texture n'est placée directement
            // dans les zones OCR.
            // ====================================================

            ctx.save();

            ctx.globalAlpha =
                0.035;

            const wmWidth =
                mm(9.8);

            const wmRatio =
                logo.height /
                logo.width;

            const wmHeight =
                wmWidth *
                wmRatio;


            ctx.drawImage(

                logo,

                (
                    width -
                    wmWidth
                ) / 2,

                mm(3.6),

                wmWidth,

                wmHeight
            );

            ctx.restore();


            // ====================================================
            // LOGO PRINCIPAL
            // ====================================================

            const logoWidth =
                Math.min(

                    width *
                        0.58,

                    mm(7.0)

                );

            const ratio =
                logo.height /
                logo.width;

            const logoHeight =
                logoWidth *
                ratio;


            ctx.drawImage(

                logo,

                (
                    width -
                    logoWidth
                ) / 2,

                mm(1.15),

                logoWidth,

                logoHeight
            );


        } catch (error) {

            console.warn(
                "[V7] Logo non chargé :",
                error.message
            );
        }
    }


    // ========================================================
    // REFERENCE OCR
    // ========================================================

    const referenceText =
        parsedReference.reference;


    const referenceAreaWidth =
        width -
        mm(2.4);


    const referenceFont =
        fitFont(

            ctx,

            referenceText,

            referenceAreaWidth,

            mm(1.15),

            fontName
        );


    ctx.font =
        `bold ${referenceFont}px ${fontName}`;

    ctx.fillStyle =
        "#000000";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";


    /*
     * Zone blanche propre.
     */

    ctx.fillText(

        referenceText,

        width / 2,

        mm(10.15)
    );


    // ========================================================
    // LOT
    // ========================================================

    const normalizedLot =
        String(lot)
            .trim()
            .toUpperCase();


    ctx.font =
        `bold ${mm(0.78)}px ${fontName}`;

    ctx.fillStyle =
        "#000000";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";


    ctx.fillText(

        `LOT ${normalizedLot}`,

        width / 2,

        mm(13.8)
    );


    // ========================================================
    // SÉRIE
    // ========================================================

    /*
     * Le renderer ne décide plus de la valeur.
     *
     * Il utilise exactement le numéro transmis par le
     * contrôleur, après passage dans encode/decode V7.
     *
     * Exemples :
     *
     * 1      -> 1
     * 999    -> 999
     * 1000   -> M
     * 1100   -> MC
     * 100000 -> CM
     */

    ctx.font =
        `bold ${mm(0.72)}px ${fontName}`;

    ctx.fillStyle =
        "#000000";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";


    ctx.fillText(

        `SERIE ${normalizedSerie}`,

        width / 2,

        mm(16.5)
    );


    // ========================================================
    // FIN MASQUE
    // ========================================================

    ctx.restore();


    // ========================================================
    // BORDURE DORÉE
    // ========================================================

    ctx.strokeStyle =
        "#D5A900";

    ctx.lineWidth =
        border;

    ctx.beginPath();

    ctx.roundRect(

        border,

        border,

        width -
            border * 2,

        height -
            border * 2,

        radius
    );

    ctx.stroke();


    // ========================================================
    // PNG
    // ========================================================

    return canvas.toBuffer(
        "image/png"
    );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    VERSION:
        "7.2.0",

    WIDTH_MM,

    HEIGHT_MM,

    DPI,

    DEFAULT_WIDTH,

    DEFAULT_HEIGHT,

    renderSealToBuffer
};