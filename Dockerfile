FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4177
EXPOSE 4177

CMD ["npm", "start"]
