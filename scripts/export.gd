extends SceneTree

func _initialize() -> void:
	call_deferred("_export")

func _bitmap(texture: Texture2D) -> Image:
	if texture is AtlasTexture:
		var atlas_texture := texture as AtlasTexture
		var atlas := _bitmap(atlas_texture.atlas)
		if atlas == null:
			return null
		var sprite := atlas.get_region(Rect2i(atlas_texture.region))
		var margin := Rect2i(atlas_texture.margin)
		if margin.size == Vector2i.ZERO:
			return sprite
		var padded := Image.create_empty(sprite.get_width() + margin.size.x, sprite.get_height() + margin.size.y, false, Image.FORMAT_RGBA8)
		sprite.convert(Image.FORMAT_RGBA8)
		padded.blit_rect(sprite, Rect2i(Vector2i.ZERO, sprite.get_size()), margin.position)
		return padded
	return texture.get_image()

func _tint(image: Image, values: Array) -> void:
	var angle := (1.0 - float(values[0])) * TAU
	var cosine := cos(angle)
	var sine := sin(angle)
	var saturation := float(values[1])
	var value := float(values[2])
	for row in range(image.get_height()):
		for column in range(image.get_width()):
			var sample := image.get_pixel(column, row)
			if sample.a == 0:
				continue
			var luminance := 0.2989 * sample.r + 0.5870 * sample.g + 0.1140 * sample.b
			var in_phase := 0.5959 * sample.r - 0.2774 * sample.g - 0.3216 * sample.b
			var quadrature := 0.2115 * sample.r - 0.5229 * sample.g + 0.3114 * sample.b
			var rotated_i := (in_phase * cosine - quadrature * sine) * saturation
			var rotated_q := (in_phase * sine + quadrature * cosine) * saturation
			image.set_pixel(column, row, Color(
				clampf((luminance + 0.956 * rotated_i + 0.621 * rotated_q) * value, 0.0, 1.0),
				clampf((luminance - 0.272 * rotated_i - 0.647 * rotated_q) * value, 0.0, 1.0),
				clampf((luminance - 1.106 * rotated_i + 1.703 * rotated_q) * value, 0.0, 1.0),
				sample.a))

var atlas_cache: Dictionary = {}

func _export() -> void:
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://jobs.json"))
	var output: String = manifest.output
	var font := load("res://" + manifest.font) as FontFile
	if font == null or font.data.is_empty() or not _write_font(font, output):
		push_error("Could not export the game font")
		quit(1)
		return
	for relative in manifest.jobs:
		var job: Dictionary = manifest.jobs[relative]
		var texture := load("res://" + job.source) as Texture2D
		if texture == null:
			push_error("Missing texture: " + job.source)
			quit(1)
			return
		var image: Image
		if texture is AtlasTexture:
			var sprite := texture as AtlasTexture
			var key := sprite.atlas.resource_path
			if not atlas_cache.has(key):
				var decoded := _bitmap(sprite.atlas)
				if decoded.is_compressed() and decoded.decompress() != OK:
					push_error("Unsupported atlas compression: " + key)
					quit(1)
					return
				atlas_cache[key] = decoded
			image = atlas_cache[key].get_region(Rect2i(sprite.region))
			var margin := Rect2i(sprite.margin)
			if margin.size != Vector2i.ZERO:
				image.convert(Image.FORMAT_RGBA8)
				var padded := Image.create_empty(image.get_width() + margin.size.x, image.get_height() + margin.size.y, false, Image.FORMAT_RGBA8)
				padded.blit_rect(image, Rect2i(Vector2i.ZERO, image.get_size()), margin.position)
				image = padded
		else:
			image = _bitmap(texture)
		if image.is_compressed() and image.decompress() != OK:
			push_error("Unsupported texture compression: " + job.source)
			quit(1)
			return
		if relative.begins_with("art/") and image.get_width() > 500:
			image.resize(500, roundi(500.0 * image.get_height() / image.get_width()), Image.INTERPOLATE_LANCZOS)
		if job.has("tint"):
			image.convert(Image.FORMAT_RGBA8)
			_tint(image, job.tint)
		var file: String = output.path_join(relative + ".png")
		DirAccess.make_dir_recursive_absolute(file.get_base_dir())
		if image.save_png(file) != OK:
			push_error("Could not export " + file)
			quit(1)
			return
	print("Exported game font and ", manifest.jobs.size(), " image layers")
	quit()

func _write_font(font: FontFile, output: String) -> bool:
	var file := FileAccess.open(output.path_join("card-font.otf"), FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(font.data)
	file.close()
	return true
