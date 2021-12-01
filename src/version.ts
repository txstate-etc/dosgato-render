import { readFileSync } from 'fs'

/**
 * The rendering server needs to be locked at a particular schemaversion so that the rendering
 * code on it will always receive data in the schema it expected at the time the code was
 * last tested.
 *
 * In order to keep that constant, we have Docker create a file during the build process with
 * the current time in it. On startup we read that file and thus keep our expected schema
 * version until the next time the software is built (and then tested).
 */
export const schemaversion = new Date(readFileSync('/.builddate', 'ascii').trim())

/**
 * Static resources like js, css, and images will never change until the next Docker
 * build. We'd like a cachebuster string we can insert into the URL for those resources, then
 * we can set the Cache-Control header to mark them as immutable so browsers hang on to them
 * and don't bother to make any revalidation requests.
 */
export const resourceversion = String(Math.round(schemaversion.getTime()))
