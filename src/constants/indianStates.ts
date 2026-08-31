export const INDIAN_STATES = [
  { value: "Andaman and Nicobar Islands", gstCode: "35" },
  { value: "Andhra Pradesh", gstCode: "37" },
  { value: "Arunachal Pradesh", gstCode: "12" },
  { value: "Assam", gstCode: "18" },
  { value: "Bihar", gstCode: "10" },
  { value: "Chandigarh", gstCode: "04" },
  { value: "Chhattisgarh", gstCode: "22" },
  { value: "Dadra and Nagar Haveli and Daman and Diu", gstCode: "26" },
  { value: "Delhi", gstCode: "07" },
  { value: "Goa", gstCode: "30" },
  { value: "Gujarat", gstCode: "24" },
  { value: "Haryana", gstCode: "06" },
  { value: "Himachal Pradesh", gstCode: "02" },
  { value: "Jammu and Kashmir", gstCode: "01" },
  { value: "Jharkhand", gstCode: "20" },
  { value: "Karnataka", gstCode: "29" },
  { value: "Kerala", gstCode: "32" },
  { value: "Ladakh", gstCode: "38" },
  { value: "Lakshadweep", gstCode: "31" },
  { value: "Madhya Pradesh", gstCode: "23" },
  { value: "Maharashtra", gstCode: "27" },
  { value: "Manipur", gstCode: "14" },
  { value: "Meghalaya", gstCode: "17" },
  { value: "Mizoram", gstCode: "15" },
  { value: "Nagaland", gstCode: "13" },
  { value: "Odisha", gstCode: "21" },
  { value: "Puducherry", gstCode: "34" },
  { value: "Punjab", gstCode: "03" },
  { value: "Rajasthan", gstCode: "08" },
  { value: "Sikkim", gstCode: "11" },
  { value: "Tamil Nadu", gstCode: "33" },
  { value: "Telangana", gstCode: "36" },
  { value: "Tripura", gstCode: "16" },
  { value: "Uttar Pradesh", gstCode: "09" },
  { value: "Uttarakhand", gstCode: "05" },
  { value: "West Bengal", gstCode: "19" },
] as const;

export type IndianState = (typeof INDIAN_STATES)[number]["value"];

export function getGstStateCode(state: string): string | undefined {
  return INDIAN_STATES.find((item) => item.value === state)?.gstCode;
}
