FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias de sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copiar requerimientos e instalar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código del proyecto
COPY . .

# Crear carpeta para uploads de imágenes si no existe
RUN mkdir -p static/uploads

# Variables de entorno por defecto
ENV PORT=5050
ENV PYTHONUNBUFFERED=1

EXPOSE 5050

# Iniciar servidor de producción gunicorn
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 2 --threads 4 --timeout 120 app:app"]
