import type { ValidateFunction } from 'ajv';
import type { TraceReport } from '../index';

/** SHA-256 of the canonical schema used to generate this static validator. */
export declare const SCHEMA_SHA256: string;
declare const validate: ValidateFunction<TraceReport>;
export default validate;
