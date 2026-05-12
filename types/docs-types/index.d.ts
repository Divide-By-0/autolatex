declare namespace google {

    namespace script {

        export interface Runner {

            withSuccessHandler(handler: (response: any, userObject?: any) => void): Runner;

            withFailureHandler(handler: (error: Error, userObject?: any) => void): Runner;

            withUserObject(object: any): Runner;

            clientRenderComplete(equations: {options: AutoLatexCommon.ClientRenderOptions, renderedEquationB64: string}[]): void //intrinsic;

            clientRenderFailed(equations: {options: AutoLatexCommon.ClientRenderOptions}[]): void //intrinsic;

            editEquations(sizeRaw: string, delimiter: string, renderer: string): void //reference;

            getKey(): void //intrinsic;

            logMathJaxClientError(payloadJson: string): void //intrinsic;

            getPrefs(): void //reflection;

            removeAll(defaultDelimRaw: string): void //intrinsic;

            replaceEquations(sizeRaw: string, delimiter: string, renderer: string): void //union;

        }

        /**
         * enums should be alphabetical in order to work with clasp-types
         */
        export const enum DocsEquationRenderStatus {

            AllRenderersFailed,

            AuthorizationFailed,

            ClientRender,

            EmptyEquation,

            MultiElementEquation,

            NoDocument,

            NoEndDelimiter,

            NoStartDelimiter,

            Success,

        }

        export const run: Runner;

    }

}
