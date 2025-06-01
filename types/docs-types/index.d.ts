declare namespace google {

    namespace script {

        export interface Runner {

            withSuccessHandler(handler: (response: any, userObject?: any) => void): Runner;

            withFailureHandler(handler: (error: Error, userObject?: any) => void): Runner;

            withUserObject(object: any): Runner;

            editEquations(sizeRaw: string, delimiter: string): void //reference;

            getKey(): void //intrinsic;

            getPrefs(): void //reflection;

            removeAll(defaultDelimRaw: string): void //intrinsic;

            replaceEquations(sizeRaw: string, delimiter: string, clientRender: boolean): void //union;

        }

        export const enum DocsEquationRenderStatus {

            AllRenderersFailed,

            ClientRender,

            EmptyEquation,

            NoDocument,

            NoEndDelimiter,

            NoStartDelimiter,

            Success,

        }

        export const run: Runner;

    }

}

