/**
 * ============================================================
 * ANOR CHECK — FORMAT SCEAU V7
 * SOURCE UNIQUE DE VÉRITÉ
 * ============================================================
 *
 * RESPONSABILITÉS :
 *
 * - Référence V7
 * - Checksum V7
 * - Normalisation OCR
 * - Variantes OCR
 * - Extraction de références
 * - Règles physiques d'impression
 * - Sérialisation ANOR compacte
 *
 * IDENTIFICATION :
 *
 * La référence V7 + checksum constitue l'identifiant
 * lisible par l'APK.
 *
 * LOT + SÉRIE :
 *
 * Données techniques de traçabilité/backend.
 *
 * Les 51 bits ANOR51 ne participent plus à l'identification V7.
 *
 * ============================================================
 */

const AnorSealFormatV7 = {

    VERSION: "V7",

    // ============================================================
    // DIMENSIONS PHYSIQUES
    // ============================================================

    MIN_WIDTH_MM: 15,

    MIN_HEIGHT_MM: 20,


    // ============================================================
    // RÉFÉRENCE V7
    // ============================================================

    REF_LENGTH: 9,

    ALPHABET:
        "ABCDEFGHJKLMNPQRSTUVWXYZ2346789",

    REF_REGEX:
        /^[A-HJ-NP-Z2-9]{9}$/,


    // ============================================================
    // IMPRESSION
    // ============================================================

    PRINT: {

        dpi: 600,

        minCharacterHeightMm: 1.6,

        recommendedCharacterHeightMm: 2.0,

        foreground:
            "#000000",

        background:
            "#FFFFFF",

        quietZoneMm:
            0.8,

        fontFamily:
            "Arial, Helvetica, sans-serif",

        fontWeight:
            "700"
    },


    // ============================================================
    // SÉRIALISATION ANOR
    // ============================================================
    //
    // RÈGLE CANONIQUE :
    //
    // 0..999 :
    //     écriture décimale directe
    //
    // À partir de 1000 :
    //
    // M = 1 000
    // G = 1 000 000
    // T = 1 000 000 000
    // P = 1 000 000 000 000
    // E = 1 000 000 000 000 000
    //
    // Les coefficients 1..999 sont écrits en notation
    // romaine canonique sans symbole M.
    //
    // Le reste final est également codé en romain.
    //
    // Exemples :
    //
    // 999        -> 999
    // 1000       -> M
    // 1100       -> MC
    // 1500       -> MD
    // 2000       -> IIM
    // 100000     -> CM
    // 1000000    -> G
    // 1100000    -> GCM
    //
    // La représentation doit être canonique :
    //
    // encodeSerial(
    //     decodeSerial(code).value
    // )
    //
    // doit toujours redonner exactement "code".
    // ============================================================

    SERIAL: {

        VERSION:
            "ANOR-SERIAL-V2",

        DIRECT_MAX:
            999,

        UNITS: [

            {
                symbol:
                    "E",

                value:
                    1000000000000000
            },

            {
                symbol:
                    "P",

                value:
                    1000000000000
            },

            {
                symbol:
                    "T",

                value:
                    1000000000
            },

            {
                symbol:
                    "G",

                value:
                    1000000
            },

            {
                symbol:
                    "M",

                value:
                    1000
            }

        ],

        ROMAN_TABLE: [

            [900, "CM"],
            [500, "D"],
            [400, "CD"],
            [100, "C"],
            [90, "XC"],
            [50, "L"],
            [40, "XL"],
            [10, "X"],
            [9, "IX"],
            [5, "V"],
            [4, "IV"],
            [1, "I"]

        ],

        ROMAN_VALUES: {

            I: 1,
            V: 5,
            X: 10,
            L: 50,
            C: 100,
            D: 500

        }
    },


    // ============================================================
    // NORMALISATION RÉFÉRENCE
    // ============================================================

    normalize(value) {

        if (
            value === undefined ||
            value === null
        ) {

            return "";
        }

        return String(value)
            .toUpperCase()
            .replace(
                /[^A-Z0-9]/g,
                ""
            )
            .split("")
            .filter(
                char =>
                    this.ALPHABET.includes(
                        char
                    )
            )
            .join("");
    },


    // ============================================================
    // CHECKSUM
    // ============================================================

    checksum(body) {

        if (
            typeof body !==
            "string"
        ) {

            return null;
        }

        let value = 0;

        for (
            let i = 0;
            i < body.length;
            i++
        ) {

            const index =
                this.ALPHABET.indexOf(
                    body[i]
                );

            if (
                index < 0
            ) {

                return null;
            }

            value =
                (
                    value * 31 +
                    index +
                    17
                ) %
                this.ALPHABET.length;
        }

        return this.ALPHABET[value];
    },


    // ============================================================
    // CRÉATION RÉFÉRENCE
    // ============================================================

    createReference(
        randomBody = null
    ) {

        let body = "";

        if (
            typeof randomBody ===
                "string" &&
            this.normalize(
                randomBody
            ).length ===
                this.REF_LENGTH - 1
        ) {

            body =
                this.normalize(
                    randomBody
                );
        }

        while (
            body.length <
            this.REF_LENGTH - 1
        ) {

            const index =
                Math.floor(
                    Math.random() *
                    this.ALPHABET.length
                );

            body +=
                this.ALPHABET[index];
        }

        body =
            body.substring(
                0,
                this.REF_LENGTH - 1
            );

        const check =
            this.checksum(
                body
            );

        if (!check) {

            throw new Error(
                "Impossible de générer le checksum V7."
            );
        }

        return body + check;
    },


    generateReference(
        randomBody = null
    ) {

        return this.createReference(
            randomBody
        );
    },


    // ============================================================
    // VALIDATION RÉFÉRENCE
    // ============================================================

    validateReference(
        reference
    ) {

        if (
            typeof reference !==
            "string"
        ) {

            return {

                valid: false,

                reason:
                    "REFERENCE_ABSENTE"
            };
        }

        const ref =
            this.normalize(
                reference
            );

        if (
            !this.REF_REGEX.test(
                ref
            )
        ) {

            return {

                valid: false,

                reason:
                    "FORMAT_INVALIDE",

                reference:
                    ref
            };
        }

        const body =
            ref.substring(
                0,
                this.REF_LENGTH - 1
            );

        const expected =
            this.checksum(
                body
            );

        const received =
            ref[
                this.REF_LENGTH - 1
            ];

        if (
            expected !==
            received
        ) {

            return {

                valid: false,

                reason:
                    "CHECKSUM_INVALIDE",

                reference:
                    ref,

                expected,

                received
            };
        }

        return {

            valid: true,

            reference:
                ref,

            body,

            checksum:
                received
        };
    },


    // ============================================================
    // OCR
    // ============================================================

    normalizeOCR(
        text
    ) {

        if (!text) {

            return "";
        }

        return String(text)
            .toUpperCase()
            .replace(
                /[\s\-_.:]/g,
                ""
            )
            .replace(
                /[^A-Z0-9]/g,
                ""
            );
    },


    // ============================================================
    // VARIANTES OCR
    // ============================================================

    generateOCRVariants(
        text
    ) {

        const base =
            this.normalizeOCR(
                text
            );

        const variants =
            new Set();

        if (!base) {

            return [];
        }

        variants.add(
            base
        );

        const substitutions = [

            ["O", "0"],
            ["0", "O"],

            ["I", "1"],
            ["1", "I"],

            ["S", "5"],
            ["5", "S"],

            ["B", "8"],
            ["8", "B"]

        ];

        for (
            const [from, to]
            of substitutions
        ) {

            for (
                let i = 0;
                i < base.length;
                i++
            ) {

                if (
                    base[i] !== from
                ) {

                    continue;
                }

                variants.add(

                    base.substring(
                        0,
                        i
                    ) +

                    to +

                    base.substring(
                        i + 1
                    )
                );
            }
        }

        return [
            ...variants
        ];
    },


    // ============================================================
    // EXTRACTION RÉFÉRENCES
    // ============================================================

    extractReferenceCandidates(
        text
    ) {

        const normalized =
            this.normalizeOCR(
                text
            );

        if (!normalized) {

            return [];
        }

        const candidates =
            new Set();

        const directMatches =
            normalized.match(
                /[A-Z0-9]{9}/g
            ) || [];

        for (
            const match
            of directMatches
        ) {

            for (
                const variant
                of this.generateOCRVariants(
                    match
                )
            ) {

                if (
                    variant.length !==
                    this.REF_LENGTH
                ) {

                    continue;
                }

                const parsed =
                    this.validateReference(
                        variant
                    );

                if (
                    parsed.valid
                ) {

                    candidates.add(
                        parsed.reference
                    );
                }
            }
        }

        return [
            ...candidates
        ];
    },


    // ============================================================
    // ROMAIN : ENCODAGE
    // ============================================================

    encodeRoman(
        value
    ) {

        if (
            !Number.isInteger(
                value
            ) ||
            value < 1 ||
            value > 999
        ) {

            throw new Error(
                "Coefficient de sérialisation invalide."
            );
        }

        let remaining =
            value;

        let result =
            "";

        for (
            const [
                amount,
                symbol
            ]
            of this.SERIAL.ROMAN_TABLE
        ) {

            while (
                remaining >= amount
            ) {

                result +=
                    symbol;

                remaining -=
                    amount;
            }
        }

        return result;
    },


    // ============================================================
    // ROMAIN : DÉCODAGE
    // ============================================================

    decodeRoman(
        text
    ) {

        if (
            typeof text !==
                "string" ||
            !text ||
            !/^[IVXLCD]+$/.test(
                text
            )
        ) {

            return null;
        }

        let total =
            0;

        for (
            let i = 0;
            i < text.length;
            i++
        ) {

            const current =
                this.SERIAL.ROMAN_VALUES[
                    text[i]
                ];

            const next =
                i + 1 <
                text.length

                    ? this.SERIAL.ROMAN_VALUES[
                        text[i + 1]
                    ]

                    : 0;

            if (
                current < next
            ) {

                total -=
                    current;

            } else {

                total +=
                    current;
            }
        }

        if (
            total < 1 ||
            total > 999
        ) {

            return null;
        }

        if (
            this.encodeRoman(
                total
            ) !== text
        ) {

            return null;
        }

        return total;
    },


    // ============================================================
    // SÉRIE : ENCODAGE
    // ============================================================

    encodeSerial(
        value
    ) {

        if (
            typeof value ===
            "string"
        ) {

            if (
                !/^\d+$/.test(
                    value.trim()
                )
            ) {

                throw new Error(
                    "Le numéro de série doit être numérique."
                );
            }

            value =
                Number(
                    value
                );
        }

        if (
            !Number.isSafeInteger(
                value
            ) ||
            value < 0
        ) {

            throw new Error(
                "Numéro de série hors limites."
            );
        }


        // --------------------------------------------------------
        // 0..999
        // --------------------------------------------------------

        if (
            value <=
            this.SERIAL.DIRECT_MAX
        ) {

            return String(
                value
            );
        }


        let remaining =
            value;

        let output =
            "";


        // --------------------------------------------------------
        // BLOCS 10^15 -> 10^3
        // --------------------------------------------------------

        for (
            const unit
            of this.SERIAL.UNITS
        ) {

            if (
                remaining <
                unit.value
            ) {

                continue;
            }

            const coefficient =
                Math.floor(
                    remaining /
                    unit.value
                );

            if (
                coefficient < 1 ||
                coefficient > 999
            ) {

                throw new Error(
                    "Coefficient de sérialisation hors limites."
                );
            }

            output +=
                this.encodeRoman(
                    coefficient
                );

            output +=
                unit.symbol;

            remaining =
                remaining %
                unit.value;
        }


        // --------------------------------------------------------
        // RESTE FINAL 1..999
        // --------------------------------------------------------

        if (
            remaining > 0
        ) {

            output +=
                this.encodeRoman(
                    remaining
                );
        }


        if (!output) {

            throw new Error(
                "Impossible d'encoder la série."
            );
        }

        return output;
    },


    // ============================================================
    // SÉRIE : DÉCODAGE
    // ============================================================

 decodeSerial(code) {

    if (
        code === undefined ||
        code === null
    ) {
        return {
            valid: false,
            reason: "SERIE_ABSENTE"
        };
    }

    const normalized =
        String(code)
            .toUpperCase()
            .replace(/[\s\-_.:]/g, "");

    if (!normalized) {
        return {
            valid: false,
            reason: "SERIE_ABSENTE"
        };
    }


    // ========================================================
    // 0..999
    // ========================================================

    if (/^\d{1,3}$/.test(normalized)) {

        const value =
            Number(normalized);

        if (
            String(value) !==
            normalized
        ) {
            return {
                valid: false,
                reason: "SERIE_NON_CANONIQUE",
                code: normalized,
                canonical: String(value)
            };
        }

        return {
            valid: true,
            code: normalized,
            value,
            canonical: normalized,
            mode: "DIRECT"
        };
    }


    // ========================================================
    // FORMAT COMPACT
    // ========================================================
    //
    // Structure :
    //
    // [coefficient romain] UNIT
    // [coefficient romain] UNIT
    // ...
    // [reste romain]
    //
    // Exemple :
    //
    // MCM
    //
    // M   = 1000
    // CM  = 900
    // total = 1900
    //
    // ========================================================

    let position = 0;

    let total = 0;

    let previousUnit =
        Number.POSITIVE_INFINITY;

    let foundUnit = false;


    while (
        position <
        normalized.length
    ) {

        // ----------------------------------------------------
        // Chercher la prochaine unité ANOR
        // ----------------------------------------------------

        let unitStart = -1;
        let unitFound = null;

        for (
            let i = position;
            i < normalized.length;
            i++
        ) {

            for (
                const unit
                of this.SERIAL.UNITS
            ) {

                if (
                    normalized.startsWith(
                        unit.symbol,
                        i
                    )
                ) {

                    unitStart = i;
                    unitFound = unit;

                    break;
                }
            }

            if (
                unitFound
            ) {
                break;
            }
        }


        // ----------------------------------------------------
        // Aucun symbole d'unité :
        // le reste doit être romain.
        // ----------------------------------------------------

        if (
            !unitFound
        ) {

            const remainderText =
                normalized.substring(
                    position
                );

            const remainder =
                this.decodeRoman(
                    remainderText
                );

            if (
                remainder === null
            ) {

                return {
                    valid: false,
                    reason:
                        "RESTE_INVALIDE",
                    code: normalized
                };
            }

            if (
                remainder >=
                (
                    previousUnit ===
                    Number.POSITIVE_INFINITY
                        ? Number.POSITIVE_INFINITY
                        : previousUnit
                )
            ) {

                return {
                    valid: false,
                    reason:
                        "RESTE_NON_CANONIQUE",
                    code: normalized
                };
            }

            total += remainder;

            position =
                normalized.length;

            break;
        }


        // ----------------------------------------------------
        // TEXTE AVANT L'UNITÉ
        // ----------------------------------------------------

        const coefficientText =
            normalized.substring(
                position,
                unitStart
            );


        /*
         * Coefficient absent = 1.
         *
         * Exemple :
         *
         * M
         * G
         * T
         */

        const coefficient =
            coefficientText
                ? this.decodeRoman(
                    coefficientText
                )
                : 1;


        if (
            coefficient === null
        ) {

            return {
                valid: false,
                reason:
                    "COEFFICIENT_ROMAIN_INVALIDE",
                code: normalized
            };
        }


        // ----------------------------------------------------
        // ORDRE DES UNITÉS
        // ----------------------------------------------------

        if (
            unitFound.value >=
            previousUnit
        ) {

            return {
                valid: false,
                reason:
                    "UNITES_NON_CANONIQUES",
                code: normalized
            };
        }


        // ----------------------------------------------------
        // AJOUT DE L'UNITÉ
        // ----------------------------------------------------

        total +=
            coefficient *
            unitFound.value;


        previousUnit =
            unitFound.value;

        foundUnit =
            true;


        /*
         * Avancer après le symbole d'unité.
         */

        position =
            unitStart +
            unitFound.symbol.length;


        /*
         * IMPORTANT :
         *
         * Après une unité, le texte restant peut être
         * le reste inférieur à cette unité.
         *
         * Exemple :
         *
         * MCM
         *   ^
         *   CM = 900
         *
         * Le prochain passage va donc lire CM comme
         * un reste, et non comme une nouvelle unité M.
         */
    }


    if (
        !foundUnit
    ) {

        return {
            valid: false,
            reason:
                "FORMAT_INVALIDE",
            code: normalized
        };
    }


    if (
        !Number.isSafeInteger(total) ||
        total < 1000
    ) {

        return {
            valid: false,
            reason:
                "VALEUR_HORS_LIMITES",
            code: normalized
        };
    }


    const canonical =
        this.encodeSerial(
            total
        );


    if (
        canonical !==
        normalized
    ) {

        return {
            valid: false,

            reason:
                "SERIE_NON_CANONIQUE",

            code:
                normalized,

            canonical,

            value:
                total
        };
    }


    return {

        valid:
            true,

        code:
            normalized,

        value:
            total,

        canonical,

        mode:
            "COMPACT"
    };
},


    // ============================================================
    // SÉRIE : VALIDATION
    // ============================================================

    validateSerial(
        code
    ) {

        const parsed =
            this.decodeSerial(
                code
            );

        if (
            !parsed.valid
        ) {

            return parsed;
        }

        return {

            valid: true,

            code:
                parsed.code,

            value:
                parsed.value,

            canonical:
                parsed.canonical,

            mode:
                parsed.mode,

            version:
                this.SERIAL.VERSION
        };
    },


    // ============================================================
    // LAYOUT
    // ============================================================

    getLayout() {

        return {

            physical: {

                widthMm:
                    this.MIN_WIDTH_MM,

                heightMm:
                    this.MIN_HEIGHT_MM
            },

            marginsMm: {

                top: 1,

                right: 1,

                bottom: 1,

                left: 1
            },

            reference: {

                x: 1.5,

                y: 10.0,

                widthMm: 12,

                heightMm: 3.2,

                fontSizeMm: 2.0,

                letterSpacingMm: 0.15,

                align: "center"
            },

            lot: {

                x: 1.5,

                y: 14.0,

                widthMm: 12,

                heightMm: 2.0,

                fontSizeMm: 1.15
            },

            serie: {

                x: 1.5,

                y: 16.5,

                widthMm: 12,

                heightMm: 2.0,

                fontSizeMm: 1.15
            }
        };
    }
};


// ============================================================
// EXPORT
// ============================================================

if (
    typeof module !==
    "undefined"
) {

    module.exports =
        AnorSealFormatV7;
}