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

# Expor a porta que a aplicação utiliza em produção
EXPOSE 80

# Variáveis de ambiente default (podem ser substituídas no Easypanel)
ENV NODE_ENV=production
ENV PORT=80

# Comando para iniciar a aplicação diretamente para melhor gestão de sinais
CMD ["node", "build/api.js"]
