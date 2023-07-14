// Type definitions for Common
// Generated using clasp-types

declare namespace AutoLatexCommon {

    /**
     * The main entry point to interact with Common
     */
    export interface Common {

        assert(value: boolean, command?: string): void;

        debugLog(...strings: any[]): void;

        derenderEquation(origURL: string): {delim: Delimiter, origEq: string};

        /**
         * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
         */
        editEquations(app: IntegratedApp, sizeRaw: string, delimiter: string): (-2 | 1 | -1 | -4 | -5 | -3);

        encodeFlag(flag: number, renderCount: number): number;

        /**
         * to get doc section from index (i.e. header, footer, body etc)
         */
        getBodyFromIndex(app: IntegratedApp, index: number): (GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection);

        /**
         * Given string of size, return integer value.
         */
        getDelimiters(delimiters: string): Delimiter;

        getKey(): string;

        getPrefs(): {delim: string, size: string};

        /**
         * NOTE: one indexed. if codecogsSlow is 1, switch order of texrendr and codecogs
         */
        getRenderer(worked: number): Renderer;

        /**
         * Given string of size, return integer value.
         */
        getSize(sizeRaw: string): (0 | -1 | 24 | 12);

        /**
         * Retrives the equation from the paragraph, encodes it, and returns it.
         */
        reEncode(equation: string): string;

        /**
         * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
         */
        removeAll(app: IntegratedApp, defaultDelimRaw: string): number;

        renderEquation(equationOriginal: string, quality: number, delim: Delimiter, isInline: boolean, red: number, green: number, blue: number): {equation: string, renderer: Renderer, rendererType: string, resp: GoogleAppsScript.URL_Fetch.HTTPResponse, worked: number};

        reportDeltaTime(line?: number, forcePrint?: string): number;

        savePrefs(size: string, delim: string): void;

        /**
         * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
         */
        sizeImage(app: IntegratedApp, paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, height: number, width: number): void;

        capableDerenderers: 12;

        capableRenderers: 8;

        invalidEquationHashCodecogsFirst50: "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%";

    }

    export interface Delimiter {

        0: string;

        1: string;

        2: string;

        3: string;

        4: number;

        5: number;

        6: number;

    }

    export interface IntegratedApp {

        getActive(): (GoogleAppsScript.Document.Document | GoogleAppsScript.Slides.Presentation);

        getBody(): (GoogleAppsScript.Document.Body | GoogleAppsScript.Slides.Slide[]);

        getPageWidth(): number;

        getUi(): GoogleAppsScript.Base.Ui;

        undoImage(delim: Delimiter): (-2 | 1 | -1 | -4 | -5 | -3);

    }

    /**
     * An array which defines a renderer
     * 
     * Note: clasp-types is not compatible with type aliases, so this is defined as an interface instead.
     */
    export interface Renderer {

        0: number;

        1: string;

        2: string;

        3: string;

        4: string;

        5: string;

        6: string;

    }

    export const capableDerenderers: 12;

    export const capableRenderers: 8;

    export const invalidEquationHashCodecogsFirst50: "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%";

}

declare const Common: AutoLatexCommon.Common;