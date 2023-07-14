declare namespace google {

    namespace script {

        export interface Runner {

            withSuccessHandler(handler: (response: any) => void): Runner;

            withFailureHandler(handler: (error: Error) => void): Runner;

            withUserObject(object: any): Runner;

            editEquations(sizeRaw: string, delimiter: string): void //union;

            getKey(): void //intrinsic;

            getPrefs(): void //reflection;

            removeAll(defaultDelimRaw: string): void //intrinsic;

            replaceEquations(sizeRaw: string, delimiter: string): void //intrinsic;

        }

        export const run: Runner;

    }

}

