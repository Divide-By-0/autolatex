declare namespace google {

    namespace script {

        export interface Runner {

            withSuccessHandler(handler: (response: any) => void): Runner;

            withFailureHandler(handler: (error: Error) => void): Runner;

            withUserObject(object: any): Runner;

        }

        export const run: Runner;

    }

}

