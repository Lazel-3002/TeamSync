local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")

local MODEL_ADI = "DistortionSilahi"
local eski = Workspace:FindFirstChild(MODEL_ADI)
if eski then
	eski:Destroy()
end

local model = Instance.new("Model")
model.Name = MODEL_ADI
model.Parent = Workspace

local ANA = CFrame.new(0, 5.5, -24)
local KOYU = Color3.fromRGB(22, 29, 39)
local ZIRH = Color3.fromRGB(48, 60, 75)
local METAL = Color3.fromRGB(91, 107, 124)
local ACIK_METAL = Color3.fromRGB(145, 163, 178)
local SIYAH = Color3.fromRGB(6, 9, 13)
local ENERJI = Color3.fromRGB(80, 255, 235)
local MOR = Color3.fromRGB(115, 55, 220)

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

local function silindir(ad: string, uzunluk: number, cap: number, cf: CFrame, renk: Color3, malzeme: Enum.Material): Part
	local p = blok(ad, Vector3.new(uzunluk, cap, cap), cf, renk, malzeme)
	p.Shape = Enum.PartType.Cylinder
	return p
end

local function kure(ad: string, cap: number, cf: CFrame, renk: Color3, malzeme: Enum.Material): Part
	local p = blok(ad, Vector3.new(cap, cap, cap), cf, renk, malzeme)
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

-- Ana silindirik mekanizma ve arkadaki enerji odasi.
local anaGovde = silindir("AnaGovde", 6.6, 3.9, ANA * CFrame.new(0, 0, 0.6) * CFrame.Angles(0, math.rad(90), 0), KOYU, Enum.Material.Metal)
silindir("GovdeOnHalka", 0.75, 4.45, ANA * CFrame.new(0, 0, -3.05) * CFrame.Angles(0, math.rad(90), 0), METAL, Enum.Material.Metal)
silindir("GovdeArkaHalka", 0.65, 4.3, ANA * CFrame.new(0, 0, 4.15) * CFrame.Angles(0, math.rad(90), 0), ZIRH, Enum.Material.Metal)
silindir("ArkaEnerjiOdasi", 2.3, 4.5, ANA * CFrame.new(0, 0, 5.4) * CFrame.Angles(0, math.rad(90), 0), KOYU, Enum.Material.Metal)
silindir("ArkaKapak", 0.6, 4.8, ANA * CFrame.new(0, 0, 6.85) * CFrame.Angles(0, math.rad(90), 0), ZIRH, Enum.Material.Metal)

-- Referanstaki katmanli, acili govde zirhlari.
for i = -2, 2 do
	local z = i * 1.25 + 0.45
	kama("SolZirh_" .. i, Vector3.new(0.75, 2.5, 1.25), ANA * CFrame.new(-2.05, 0, z) * CFrame.Angles(0, 0, math.rad(-90)), ZIRH, Enum.Material.Metal)
	kama("SagZirh_" .. i, Vector3.new(0.75, 2.5, 1.25), ANA * CFrame.new(2.05, 0, z) * CFrame.Angles(0, 0, math.rad(90)), ZIRH, Enum.Material.Metal)
	blok("UstOmurga_" .. i, Vector3.new(1.65, 0.32, 0.85), ANA * CFrame.new(0, 2.02, z), METAL, Enum.Material.Metal)
end

-- Govdenin ustunden arkaya uzanan tasiyici cerceve.
blok("SolUstCerceve", Vector3.new(0.38, 0.48, 7.2), ANA * CFrame.new(-2.35, 2.15, 2.5) * CFrame.Angles(math.rad(-4), 0, 0), KOYU, Enum.Material.Metal)
blok("SagUstCerceve", Vector3.new(0.38, 0.48, 7.2), ANA * CFrame.new(2.35, 2.15, 2.5) * CFrame.Angles(math.rad(-4), 0, 0), KOYU, Enum.Material.Metal)
kama("SolCerceveBurnu", Vector3.new(0.48, 0.7, 2.2), ANA * CFrame.new(-2.35, 1.9, -2.25), ZIRH, Enum.Material.Metal)
kama("SagCerceveBurnu", Vector3.new(0.48, 0.7, 2.2), ANA * CFrame.new(2.35, 1.9, -2.25), ZIRH, Enum.Material.Metal)
blok("ArkaCerceveBaglanti", Vector3.new(5, 0.5, 0.55), ANA * CFrame.new(0, 2.05, 6), ZIRH, Enum.Material.Metal)

-- Referanstaki 2x2 dizilmis, dort kalin namlulu on mekanizma.
silindir("NamluTamburu", 2.5, 4.6, ANA * CFrame.new(0, 0, -4.65) * CFrame.Angles(0, math.rad(90), 0), ZIRH, Enum.Material.Metal)
silindir("NamluTamburuOn", 0.7, 4.9, ANA * CFrame.new(0, 0, -6.25) * CFrame.Angles(0, math.rad(90), 0), METAL, Enum.Material.Metal)

local namluYerleri = {
	Vector2.new(-0.9, 0.9),
	Vector2.new(0.9, 0.9),
	Vector2.new(-0.9, -0.9),
	Vector2.new(0.9, -0.9),
}

for i, yer in namluYerleri do
	local namluRengi = if i % 2 == 0 then ACIK_METAL else METAL

	silindir(
		"NamluKovani_" .. i,
		1.45,
		1.38,
		ANA * CFrame.new(yer.X, yer.Y, -6.95) * CFrame.Angles(0, math.rad(90), 0),
		ZIRH,
		Enum.Material.Metal
	)

	silindir(
		"Namlu_" .. i,
		4.8,
		1.02,
		ANA * CFrame.new(yer.X, yer.Y, -9.65) * CFrame.Angles(0, math.rad(90), 0),
		namluRengi,
		Enum.Material.Metal
	)

	silindir(
		"NamluUcu_" .. i,
		0.48,
		1.22,
		ANA * CFrame.new(yer.X, yer.Y, -12.25) * CFrame.Angles(0, math.rad(90), 0),
		KOYU,
		Enum.Material.Metal
	)

	silindir(
		"NamluAgzi_" .. i,
		0.18,
		0.62,
		ANA * CFrame.new(yer.X, yer.Y, -12.58) * CFrame.Angles(0, math.rad(90), 0),
		SIYAH,
		Enum.Material.SmoothPlastic
	)
end

-- Camgobegi enerji cekirdekleri ve animasyonlu kristal kafesleri.
local solMerkez = ANA * CFrame.new(-2.65, 0.25, 1)
local sagMerkez = ANA * CFrame.new(2.65, 0.25, 1)
local solCekirdek = kure("SolEnerjiCekirdegi", 1.15, solMerkez, ENERJI, Enum.Material.Neon)
local sagCekirdek = kure("SagEnerjiCekirdegi", 1.15, sagMerkez, ENERJI, Enum.Material.Neon)

silindir("SolCekirdekYuvasi", 0.48, 1.8, ANA * CFrame.new(-2.5, 0.25, 1), ZIRH, Enum.Material.Metal)
silindir("SagCekirdekYuvasi", 0.48, 1.8, ANA * CFrame.new(2.5, 0.25, 1), ZIRH, Enum.Material.Metal)

local enerjiKanatlari = {}
for taraf, merkez in { solMerkez, sagMerkez } do
	for i = 1, 4 do
		local kanat = kama(
			"EnerjiKanadi_" .. taraf .. "_" .. i,
			Vector3.new(0.38, 0.95, 0.72),
			merkez,
			if i % 2 == 0 then ENERJI else ACIK_METAL,
			if i % 2 == 0 then Enum.Material.Neon else Enum.Material.Glass
		)
		kanat.Transparency = if i % 2 == 0 then 0.05 else 0.25
		table.insert(enerjiKanatlari, {
			parca = kanat,
			merkez = merkez,
			offset = (i - 1) * math.pi / 2,
			yon = if taraf == 1 then 1 else -1,
		})
	end
end

for i = -1, 1 do
	local morHucreSol = kure("MorHucreSol_" .. i, 0.48, ANA * CFrame.new(-1.55, -1.5, 3.7 + i * 0.72), MOR, Enum.Material.Neon)
	local morHucreSag = kure("MorHucreSag_" .. i, 0.48, ANA * CFrame.new(1.55, -1.5, 3.7 + i * 0.72), MOR, Enum.Material.Neon)
	morHucreSol.Transparency = 0.08
	morHucreSag.Transparency = 0.08
end

-- Tutma bolumu, tetik korumasi ve alt denge parcasi.
blok("Kabza", Vector3.new(1.35, 3.1, 1.45), ANA * CFrame.new(0, -3.1, 2.25) * CFrame.Angles(math.rad(-13), 0, 0), KOYU, Enum.Material.SmoothPlastic)
kama("KabzaArka", Vector3.new(1.45, 2.8, 1.15), ANA * CFrame.new(0, -3.1, 3.1) * CFrame.Angles(math.rad(-13), 0, 0), ZIRH, Enum.Material.SmoothPlastic)
silindir("TetikKorkulugu", 1.4, 0.22, ANA * CFrame.new(0, -1.75, 0.8) * CFrame.Angles(0, 0, math.rad(90)), METAL, Enum.Material.Metal)
blok("Tetik", Vector3.new(0.2, 0.8, 0.22), ANA * CFrame.new(0, -2.05, 0.8), ACIK_METAL, Enum.Material.Metal)
blok("AltDenge", Vector3.new(1.8, 0.6, 4.2), ANA * CFrame.new(0, -2, -2.15), ZIRH, Enum.Material.Metal)
kama("AltDengeUcu", Vector3.new(1.85, 0.9, 1.3), ANA * CFrame.new(0, -2, -4.85), KOYU, Enum.Material.Metal)

model.PrimaryPart = anaGovde

-- Cekirdekler nefes alir gibi parlar; kristal kanatlar ters yonlerde doner.
local animasyonBaglantisi: RBXScriptConnection?
animasyonBaglantisi = RunService.Heartbeat:Connect(function()
	if not model.Parent then
		if animasyonBaglantisi then
			animasyonBaglantisi:Disconnect()
		end
		return
	end

	local zaman = Workspace.DistributedGameTime
	local nabiz = (math.sin(zaman * 3.2) + 1) / 2
	local cekirdekBoyutu = 1.08 + nabiz * 0.22

	solCekirdek.Size = Vector3.new(cekirdekBoyutu, cekirdekBoyutu, cekirdekBoyutu)
	sagCekirdek.Size = Vector3.new(cekirdekBoyutu, cekirdekBoyutu, cekirdekBoyutu)

	for _, veri in enerjiKanatlari do
		local aci = veri.offset + zaman * 2.4 * veri.yon
		veri.parca.CFrame = veri.merkez
			* CFrame.Angles(aci, 0, 0)
			* CFrame.new(0, 0, -1.03)
			* CFrame.Angles(0, math.rad(18), math.rad(25))
	end
end)
