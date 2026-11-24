# RS.ge Waybill MCP

Domain vocabulary for interacting with the Revenue Service of Georgia (RS.ge) electronic waybill system. Georgian is the primary human-facing language, paired with canonical English equivalents used in code and tool names.

## Language

**ზედნადები (Waybill)**:
ელექტრონული დოკუმენტი, რომელიც ადასტურებს საქონლის ტრანსპორტირებას ან მიწოდებას საქართველოს ტერიტორიაზე RS.ge-ის სისტემაში. An electronic document recording the transport or delivery of goods within Georgia on RS.ge.
_Avoid_: Shipping slip, delivery note, dispatch, receipt

**ზედნადების სტატუსი (Waybill Status)**:
ზედნადების სასიცოცხლო ციკლის მდგომარეობა RS.ge-ში: შენახული (Draft), გააქტიურებული (Active), დასრულებული (Completed), გაუქმებული (Cancelled) ან წაშლილი (Deleted). The lifecycle state of a Waybill in RS.ge.
_Avoid_: State, phase, stage

**გამყიდველი (Seller)**:
გადასახადის გადამხდელი, რომელიც ქმნის და აგზავნის გამავალ ზედნადებს საქონლის მიწოდებისას. The Taxpayer who creates and issues an outgoing Waybill for supplied goods.
_Avoid_: Supplier, vendor, sender, issuer

**მყიდველი (Buyer)**:
გადასახადის გადამხდელი, რომელიც იღებს შემომავალ ზედნადებს და უფლებამოსილია დაადასტუროს ან უარყოს იგი. The Taxpayer who receives an incoming Waybill and may confirm or reject it.
_Avoid_: Customer, client, recipient, consignee

**გადასახადის გადამხდელი (Taxpayer)**:
საქართველოს შემოსავლების სამსახურში (RS.ge) რეგისტრირებული ფიზიკური ან იურიდიული პირი, იდენტიფიცირებული საიდენტიფიკაციო კოდით. An individual or legal entity registered with the Revenue Service of Georgia, identified by a TIN.
_Avoid_: Company, account, organization, entity

**საიდენტიფიკაციო კოდი (TIN)**:
გადასახადის გადამხდელის უნიკალური საგადასახადო ნომერი (9-ნიშნა იურიდიული პირისთვის, 11-ნიშნა ფიზიკური პირისთვის). A Taxpayer's unique Tax Identification Number in Georgia (9 digits for legal entities, 11 digits for individuals).
_Avoid_: Tax ID, personal ID, company code, UN ID

**სერვისის მომხმარებელი (Service User)**:
გადასახადის გადამხდელის RS.ge პროფილში შექმნილი სპეციალური მომხმარებელი პროგრამული წვდომისთვის, განცალკევებული პორტალის ძირითადი ანგარიშისგან. A dedicated credential pair created inside a Taxpayer's RS.ge profile for programmatic access, separate from primary portal login credentials.
_Avoid_: API user, bot account, portal login

**ანგარიშ-ფაქტურა (Tax Invoice)**:
დღგ-ის გადამხდელის მიერ გამოწერილი საგადასახადო დოკუმენტი, რომელიც პირველ ვერსიაში იქმნება კონკრეტულ ზედნადებთან დაკავშირებით. A VAT tax invoice document, created in v1 specifically linked to an existing Waybill.
_Avoid_: Bill, receipt, payment request

**საქონლის პოზიცია (Line Item)**:
ზედნადებში შეტანილი კონკრეტული საქონლის ჩანაწერი დასახელებით, ზომის ერთეულით, რაოდენობით, ერთეულის ფასითა და დღგ-ის ტიპით. A single goods entry on a Waybill specifying name, unit of measurement, quantity, unit price, and VAT type.
_Avoid_: Product, SKU, cargo item, row

**ზედნადების ტიპი (Waybill Type)**:
RS.ge-ის საცნობარო კატეგორია, რომელიც განსაზღვრავს საქონლის მიწოდების ან გადაადგილების სახეს (მაგ., შიდა გადაზიდვა, ტრანსპორტირებით, ტრანსპორტირების გარეშე, დისტრიბუცია, უკან დაბრუნება). A reference category in RS.ge defining the kind of goods movement or supply.
_Avoid_: Delivery mode, category

**ტრანსპორტირების ტიპი (Transport Type)**:
RS.ge-ის საცნობარო კატეგორია, რომელიც განსაზღვრავს გადაზიდვის საშუალებას (მაგ., საავტომობილო, სარკინიგზო, საჰაერო). A reference category in RS.ge specifying the mode of transport.
_Avoid_: Shipping method, carrier type

**საცნობარო მონაცემები (Reference Data)**:
RS.ge-ის სისტემური ცნობარები — ზედნადების ტიპები, ზომის ერთეულები, ტრანსპორტირების ტიპები და შეცდომის კოდები. RS.ge's system lookup tables: waybill types, measurement units, transport types, and error codes.
_Avoid_: Metadata, enums, static tables
