import nodeFs from 'node:fs';
import {createRequire} from 'node:module';

// External bodies are physical files. Electron's fs transparently expands ASAR
// packages, which would change their inventory and break byte-for-byte copies.
const fs=process.versions.electron?createRequire(import.meta.url)('original-fs'):nodeFs;
export default fs;
export const {createReadStream,readdirSync,lstatSync,statSync,statfsSync,existsSync,realpathSync,openSync,closeSync,readSync}=fs;
