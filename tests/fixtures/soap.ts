export function soapEnvelope(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<soap:Body>${bodyXml}</soap:Body>` +
    `</soap:Envelope>`
  );
}

export function checkServiceUserSuccessXml(
  unId = 731937,
  serviceUserId = 20350,
): string {
  return soapEnvelope(
    `<chek_service_userResponse xmlns="http://tempuri.org/">` +
      `<chek_service_userResult>true</chek_service_userResult>` +
      `<un_id>${unId}</un_id>` +
      `<s_user_id>${serviceUserId}</s_user_id>` +
      `</chek_service_userResponse>`,
  );
}

export function checkServiceUserInvalidXml(): string {
  return soapEnvelope(
    `<chek_service_userResponse xmlns="http://tempuri.org/">` +
      `<chek_service_userResult>false</chek_service_userResult>` +
      `<un_id>-3</un_id>` +
      `<s_user_id>-3</s_user_id>` +
      `</chek_service_userResponse>`,
  );
}

export function soapFaultXml(faultCode: string, faultString: string): string {
  return soapEnvelope(
    `<soap:Fault>` +
      `<faultcode>${faultCode}</faultcode>` +
      `<faultstring>${faultString}</faultstring>` +
      `<detail />` +
      `</soap:Fault>`,
  );
}

export function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

export function waybillTypesXml(
  items: ReadonlyArray<{ id: number; name: string }> = [
    { id: 1, name: 'შიდა გადაზიდვა' },
    { id: 2, name: 'ტრანსპორტირებით' },
    { id: 3, name: 'ტრანსპორტირების გარეშე' },
  ],
): string {
  const rows = items
    .map(
      (item) =>
        `<WAYBILL_TYPE><ID>${item.id}</ID><NAME>${item.name}</NAME></WAYBILL_TYPE>`,
    )
    .join('');
  return soapEnvelope(
    `<get_waybill_typesResponse xmlns="http://tempuri.org/">` +
      `<get_waybill_typesResult><WAYBILL_TYPES>${rows}</WAYBILL_TYPES></get_waybill_typesResult>` +
      `</get_waybill_typesResponse>`,
  );
}

export function waybillUnitsXml(
  items: ReadonlyArray<{ id: number; name: string }> = [
    { id: 1, name: 'ცალი' },
    { id: 2, name: 'კგ' },
    { id: 99, name: 'სხვა' },
  ],
): string {
  const rows = items
    .map(
      (item) =>
        `<WAYBILL_UNIT><ID>${item.id}</ID><NAME>${item.name}</NAME></WAYBILL_UNIT>`,
    )
    .join('');
  return soapEnvelope(
    `<get_waybill_unitsResponse xmlns="http://tempuri.org/">` +
      `<get_waybill_unitsResult><WAYBILL_UNITS>${rows}</WAYBILL_UNITS></get_waybill_unitsResult>` +
      `</get_waybill_unitsResponse>`,
  );
}

export function transportTypesXml(
  items: ReadonlyArray<{ id: number; name: string }> = [
    { id: 1, name: 'საავტომობილო' },
    { id: 2, name: 'სარკინიგზო' },
    { id: 4, name: 'სხვა' },
  ],
): string {
  const rows = items
    .map(
      (item) =>
        `<TRANSPORT_TYPE><ID>${item.id}</ID><NAME>${item.name}</NAME></TRANSPORT_TYPE>`,
    )
    .join('');
  return soapEnvelope(
    `<get_trans_typesResponse xmlns="http://tempuri.org/">` +
      `<get_trans_typesResult><TRANSPORT_TYPES>${rows}</TRANSPORT_TYPES></get_trans_typesResult>` +
      `</get_trans_typesResponse>`,
  );
}

export function errorCodesXml(
  items: ReadonlyArray<{ id: number; text: string; type: number }> = [
    {
      id: -100,
      text: 'სერვისის მომხმარებლის სახელი ან პაროლი არასწორია',
      type: 1,
    },
    { id: -101, text: 'ზედნადები არ ეკუთვნის გადამხდელს', type: 1 },
    { id: -1001, text: 'ზედნადების ტიპი არასწორია', type: 1 },
    { id: -2004, text: 'მიუთითეთ ზომის ერთეულის დასახელება', type: 2 },
  ],
  variant: 'ERROR_CODES' | 'WAYBILL_TYPES' = 'ERROR_CODES',
): string {
  const container = variant === 'ERROR_CODES' ? 'ERROR_CODES' : 'WAYBILL_TYPES';
  const itemTag = variant === 'ERROR_CODES' ? 'ERROR_CODE' : 'WAYBILL_TYPE';
  const rows = items
    .map(
      (item) =>
        `<${itemTag}><ID>${item.id}</ID><TEXT>${item.text}</TEXT><TYPE>${item.type}</TYPE></${itemTag}>`,
    )
    .join('');
  return soapEnvelope(
    `<get_error_codesResponse xmlns="http://tempuri.org/">` +
      `<get_error_codesResult><${container}>${rows}</${container}></get_error_codesResult>` +
      `</get_error_codesResponse>`,
  );
}

export function rsgeResultStatusErrorXml(
  operation: string,
  statusCode: number,
): string {
  return soapEnvelope(
    `<${operation}Response xmlns="http://tempuri.org/">` +
      `<${operation}Result><RESULT xmlns=""><STATUS>${statusCode}</STATUS></RESULT></${operation}Result>` +
      `</${operation}Response>`,
  );
}

export function scalarOperationResultXml(
  operation: string,
  value: string | number | boolean,
): string {
  return soapEnvelope(
    `<${operation}Response xmlns="http://tempuri.org/">` +
      `<${operation}Result>${value}</${operation}Result>` +
      `</${operation}Response>`,
  );
}

export function saveInvoiceResultXml(
  resultCode: number,
  outInvId: number,
): string {
  return soapEnvelope(
    `<save_invoiceResponse xmlns="http://tempuri.org/">` +
      `<save_invoiceResult>${resultCode}</save_invoiceResult>` +
      `<out_inv_id>${outInvId}</out_inv_id>` +
      `</save_invoiceResponse>`,
  );
}
