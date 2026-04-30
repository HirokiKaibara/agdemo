import type { LegacyAnalysisDocument, LegacyTableReference } from "./types.js";

const TABLE_NAME_MAP: Record<string, string> = {
  Customers: "顧客",
  Customer: "顧客",
  Products: "商品",
  Product: "商品",
  SalesOrders: "売上",
  SalesOrder: "売上",
  SalesOrderDetails: "売上明細",
  SalesOrderDetail: "売上明細",
  Invoices: "請求",
  Invoice: "請求",
  Receivables: "売掛残高",
  Receivable: "売掛残高",
  ReceivableBalances: "売掛残高",
  Payments: "入金",
  Payment: "入金",
  MonthlySalesSummary: "月次売上集計",
  MonthlySalesSummaries: "月次売上集計",
  MonthlySummary: "月次集計",
  InvoiceHistory: "請求履歴",
  BillingHistory: "請求履歴",
  SalesResults: "売上実績"
};

const COLUMN_NAME_MAP: Record<string, string> = {
  CustomerID: "顧客ID",
  CustomerCode: "顧客コード",
  CustomerName: "顧客名",
  Address: "住所",
  ContactInfo: "連絡先",
  CustomerRank: "顧客ランク",
  ProductID: "商品ID",
  ProductCode: "商品コード",
  ProductName: "商品名",
  UnitPrice: "単価",
  SalesOrderID: "売上番号",
  SalesOrderDetailID: "売上明細ID",
  OrderDate: "売上日",
  Quantity: "数量",
  TotalAmount: "売上金額",
  TaxAmount: "税額",
  GrandTotal: "請求金額",
  IsBilledFlag: "請求書出力済フラグ",
  InvoiceID: "請求ID",
  InvoiceDate: "請求日",
  InvoiceStatus: "請求状態",
  Status: "状態",
  ReceivableID: "売掛ID",
  ReceivableDate: "売掛計上日",
  Amount: "金額",
  DueDate: "支払期限",
  AgingDays: "経過日数",
  PaymentID: "入金ID",
  PaymentDate: "入金日",
  PaymentMethod: "入金方法",
  ReferenceNumber: "参照番号",
  SummaryMonth: "対象月",
  TotalSalesExcludingTax: "売上金額税抜",
  TotalTax: "税額合計",
  TotalSalesIncludingTax: "売上金額税込",
  CreatedAt: "作成日時",
  UpdatedAt: "更新日時",
  CreatedBy: "作成者",
  UpdatedBy: "更新者",
  LineAmount: "明細金額",
  LineTaxAmount: "明細税額",
  LineGrandTotal: "明細合計金額"
};

const ASCII_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\s*\(.*\))?$/u;
const JAPANESE_PATTERN = /[ぁ-んァ-ヶ一-龠]/u;

function looksJapanese(value: string): boolean {
  return JAPANESE_PATTERN.test(value);
}

function splitIdentifierSuffix(value: string): { base: string; suffix: string } {
  const match = value.trim().match(/^([A-Za-z][A-Za-z0-9_]*)(.*)$/u);

  if (!match) {
    return {
      base: value.trim(),
      suffix: ""
    };
  }

  return {
    base: match[1] ?? value.trim(),
    suffix: match[2] ?? ""
  };
}

function replaceMappedTerms(value: string, mappings: Record<string, string>): string {
  const entries = Object.entries(mappings).sort((left, right) => right[0].length - left[0].length);
  let localized = value;

  for (const [source, target] of entries) {
    localized = localized.replaceAll(source, target);
  }

  return localized;
}

function localizeIdentifier(value: string, mappings: Record<string, string>): string {
  const trimmed = value.trim();

  if (!trimmed || looksJapanese(trimmed)) {
    return trimmed;
  }

  if (mappings[trimmed]) {
    return mappings[trimmed];
  }

  if (!ASCII_IDENTIFIER_PATTERN.test(trimmed)) {
    return replaceMappedTerms(trimmed, mappings);
  }

  const { base, suffix } = splitIdentifierSuffix(trimmed);
  const localizedBase = mappings[base] ?? base;

  return localizedBase === base ? replaceMappedTerms(trimmed, mappings) : `${localizedBase}${suffix}`;
}

function localizeTableReference(table: LegacyTableReference): LegacyTableReference {
  const localizedName = localizeIdentifier(table.name, TABLE_NAME_MAP);
  const localizedColumns = table.columns.map((column) => localizeIdentifier(column, COLUMN_NAME_MAP));

  return {
    ...table,
    name: localizedName,
    columns: localizedColumns,
    usage: replaceMappedTerms(table.usage, { ...TABLE_NAME_MAP, ...COLUMN_NAME_MAP }),
    notes: replaceMappedTerms(table.notes, { ...TABLE_NAME_MAP, ...COLUMN_NAME_MAP })
  };
}

export function localizeDesignSchemaToJapanese(analysis: LegacyAnalysisDocument): LegacyAnalysisDocument {
  return {
    ...analysis,
    design: {
      ...analysis.design,
      tables: analysis.design.tables.map(localizeTableReference)
    }
  };
}
