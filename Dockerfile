FROM node:20-alpine

# Mudar diretório de trabalho
WORKDIR /app

# Copiar ficheiros de dependências
COPY package.json package-lock.json* ./

# Instalar dependências
RUN npm ci

# Copiar o resto do código
COPY . .

# Compilar TypeScript
RUN npm run build

# Expor a porta que a aplicação utiliza
EXPOSE 3003

# Variáveis de ambiente default (podem ser substituídas no Easypanel)
ENV NODE_ENV=production
ENV PORT=3003

# Comando para iniciar a aplicação
CMD ["npm", "start"]
