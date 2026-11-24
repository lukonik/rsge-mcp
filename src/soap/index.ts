export {
  createSoapClient,
  SoapFaultError,
  SoapParseError,
  SoapTransportError,
  type CheckServiceUserResult,
  type CreateSoapClientOptions,
  type RsgeSoapClient,
} from './client.js';
export {
  SOAP_NAMESPACE,
  buildSoapEnvelope,
  createBooleanResultResponseSchema,
  createIntResultResponseSchema,
  escapeXml,
  parseSoapXml,
  serializeSoapParams,
  toArray,
  xmlBooleanSchema,
  xmlIntSchema,
  type SoapParamValue,
} from './xml.js';
