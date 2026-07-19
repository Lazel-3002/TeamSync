local Workspace = game:GetService("Workspace")

local MODEL_ADI = "KaliteliYay"
local eski = Workspace:FindFirstChild(MODEL_ADI)
if eski then
	eski:Destroy()
end

local model = Instance.new("Model")
model.Name = MODEL_ADI
model.Parent = Workspace

local MERKEZ = Vector3.new(13, 6.3, -24)
local AHSAP = Color3.fromRGB(147, 81, 42)
local AHSAP_ACIK = Color3.fromRGB(201, 125, 66)
local AHSAP_KOYU = Color3.fromRGB(74, 39, 25)
local METAL = Color3.fromRGB(125, 137, 148)
local METAL_ACIK = Color3.fromRGB(205, 216, 225)
local SIYAH = Color3.fromRGB(20, 23, 27)
local IP_RENGI = Color3.fromRGB(225, 226, 218)

local function blok(ad: string, boyut: Vector3, cf: CFrame, renk: Color3, malzeme: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = ad
	p.Size = boyut
	p.CFrame = cf
	p.Color = renk
	p.Material = malzeme
	p.Anchored = true
	p.CanCollide = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = model
	return p
end

local function cubuk(ad: string, baslangic: Vector3, bitis: Vector3, kalinlik: number, renk: Color3, malzeme: Enum.Material): Part
	local yon = bitis - baslangic
	local uzunluk = yon.Magnitude
	local xEkseni = yon.Unit
	local geciciYukari = Vector3.yAxis
	if math.abs(xEkseni:Dot(geciciYukari)) > 0.96 then
		geciciYukari = Vector3.zAxis
	end
	local zEkseni = xEkseni:Cross(geciciYukari).Unit
	local yEkseni = zEkseni:Cross(xEkseni).Unit
	local cf = CFrame.fromMatrix((baslangic + bitis) / 2, xEkseni, yEkseni, zEkseni)

	local p = blok(ad, Vector3.new(uzunluk, kalinlik, kalinlik), cf, renk, malzeme)
	p.Shape = Enum.PartType.Cylinder
	return p
end

local function kure(ad: string, konum: Vector3, cap: number, renk: Color3, malzeme: Enum.Material): Part
	local p = blok(ad, Vector3.new(cap, cap, cap), CFrame.new(konum), renk, malzeme)
	p.Shape = Enum.PartType.Ball
	return p
end

local function kama(ad: string, boyut: Vector3, cf: CFrame, renk: Color3, malzeme: Enum.Material): WedgePart
	local p = Instance.new("WedgePart")
	p.Name = ad
	p.Size = boyut
	p.CFrame = cf
	p.Color = renk
	p.Material = malzeme
	p.Anchored = true
	p.CanCollide = false
	p.Parent = model
	return p
end

local function dunya(yerel: Vector3): Vector3
	return MERKEZ + yerel
end

-- Kavisli yay kollari: kisa parcalar yumusak bir egri olusturur.
local ustNoktalar = {
	Vector3.new(0, 0.8, 0),
	Vector3.new(-0.28, 1.65, 0),
	Vector3.new(-0.7, 2.55, 0),
	Vector3.new(-1.05, 3.5, 0),
	Vector3.new(-1.12, 4.45, 0),
	Vector3.new(-0.78, 5.28, 0),
	Vector3.new(-0.25, 5.9, 0),
}

local altNoktalar = {
	Vector3.new(0, -0.8, 0),
	Vector3.new(-0.28, -1.65, 0),
	Vector3.new(-0.7, -2.55, 0),
	Vector3.new(-1.05, -3.5, 0),
	Vector3.new(-1.12, -4.45, 0),
	Vector3.new(-0.78, -5.28, 0),
	Vector3.new(-0.25, -5.9, 0),
}

local function kolOlustur(noktalar: { Vector3 }, onEk: string)
	for i = 1, #noktalar - 1 do
		local renk = if i % 2 == 0 then AHSAP_ACIK else AHSAP
		local kalinlik = 0.48 - (i - 1) * 0.035
		cubuk(onEk .. "Ana_" .. i, dunya(noktalar[i]), dunya(noktalar[i + 1]), kalinlik, renk, Enum.Material.Wood)

		-- Koyu dis katman, yaya derinlik ve lamine ahsap gorunumu verir.
		local zOfset = Vector3.new(0, 0, 0.24)
		cubuk(onEk .. "Katman_" .. i, dunya(noktalar[i]) + zOfset, dunya(noktalar[i + 1]) + zOfset, kalinlik * 0.28, AHSAP_KOYU, Enum.Material.Wood)
	end

	for i = 2, #noktalar - 1 do
		kure(onEk .. "Baglanti_" .. i, dunya(noktalar[i]), 0.43 - i * 0.02, if i % 2 == 0 then AHSAP_ACIK else AHSAP, Enum.Material.Wood)
	end
end

kolOlustur(ustNoktalar, "UstKol")
kolOlustur(altNoktalar, "AltKol")

local ustUc = dunya(ustNoktalar[#ustNoktalar])
local altUc = dunya(altNoktalar[#altNoktalar])
local cekisNoktasi = dunya(Vector3.new(-3.15, 0, 0))

-- Koyu metal yay uclari ve ip yuvalari.
cubuk("UstUçKaplama", dunya(ustNoktalar[#ustNoktalar - 1]), ustUc, 0.42, SIYAH, Enum.Material.Metal)
cubuk("AltUçKaplama", dunya(altNoktalar[#altNoktalar - 1]), altUc, 0.42, SIYAH, Enum.Material.Metal)
kure("UstIpYuvasi", ustUc, 0.3, METAL, Enum.Material.Metal)
kure("AltIpYuvasi", altUc, 0.3, METAL, Enum.Material.Metal)

-- Gerilmis yay ipi.
cubuk("UstIp", ustUc, cekisNoktasi, 0.075, IP_RENGI, Enum.Material.SmoothPlastic)
cubuk("AltIp", cekisNoktasi, altUc, 0.075, IP_RENGI, Enum.Material.SmoothPlastic)

-- Orta tutamak ve deri sarim bantlari.
local tutamak = blok("Tutamak", Vector3.new(0.82, 1.85, 0.72), CFrame.new(MERKEZ), AHSAP_KOYU, Enum.Material.Wood)
kama("UstTutamakGecisi", Vector3.new(0.9, 0.8, 0.78), CFrame.new(dunya(Vector3.new(-0.03, 1.25, 0))) * CFrame.Angles(0, 0, math.rad(180)), AHSAP, Enum.Material.Wood)
kama("AltTutamakGecisi", Vector3.new(0.9, 0.8, 0.78), CFrame.new(dunya(Vector3.new(-0.03, -1.25, 0))), AHSAP, Enum.Material.Wood)

for i = -3, 3 do
	blok(
		"DeriSargi_" .. i,
		Vector3.new(0.9, 0.1, 0.79),
		CFrame.new(dunya(Vector3.new(0, i * 0.22, 0))) * CFrame.Angles(0, 0, math.rad(i * 2)),
		if i % 2 == 0 then SIYAH else Color3.fromRGB(58, 35, 27),
		Enum.Material.Fabric
	)
end

-- Ok saftı, metal ucu, tuyleri ve ipteki kertik.
local okArka = cekisNoktasi - Vector3.new(0.55, 0, 0)
local okOn = dunya(Vector3.new(4.4, 0, 0))
cubuk("OkSafti", okArka, okOn, 0.16, AHSAP_ACIK, Enum.Material.Wood)

-- Safta bindirilmis, yandan da belirgin gorunen klasik sivri ok basi.
silindir("OkUcuBilezigi", 0.42, 0.42, CFrame.new(dunya(Vector3.new(4.38, 0, 0))), METAL, Enum.Material.Metal)
blok("OkUcuOmurgasi", Vector3.new(1.45, 0.18, 0.24), CFrame.new(dunya(Vector3.new(5.02, 0, 0))), METAL_ACIK, Enum.Material.Metal)
kama(
	"OkUcuUst",
	Vector3.new(0.48, 1.05, 1.8),
	CFrame.new(dunya(Vector3.new(5.05, 0.25, 0))) * CFrame.Angles(0, math.rad(90), 0),
	METAL_ACIK,
	Enum.Material.Metal
)
kama(
	"OkUcuAlt",
	Vector3.new(0.48, 1.05, 1.8),
	CFrame.new(dunya(Vector3.new(5.05, -0.25, 0))) * CFrame.Angles(math.rad(180), math.rad(90), 0),
	METAL,
	Enum.Material.Metal
)

kama("UstTuy", Vector3.new(0.85, 0.5, 0.08), CFrame.new(okArka + Vector3.new(0.5, 0.28, 0)), Color3.fromRGB(235, 235, 228), Enum.Material.SmoothPlastic)
kama("AltTuy", Vector3.new(0.85, 0.5, 0.08), CFrame.new(okArka + Vector3.new(0.5, -0.28, 0)) * CFrame.Angles(math.rad(180), 0, 0), Color3.fromRGB(205, 210, 215), Enum.Material.SmoothPlastic)
kama("YanTuy", Vector3.new(0.85, 0.5, 0.08), CFrame.new(okArka + Vector3.new(0.5, 0, 0.28)) * CFrame.Angles(math.rad(90), 0, 0), Color3.fromRGB(170, 178, 188), Enum.Material.SmoothPlastic)
kure("OkKertigi", okArka, 0.24, METAL, Enum.Material.Metal)

model.PrimaryPart = tutamak
